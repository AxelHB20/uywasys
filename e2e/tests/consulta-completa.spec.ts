import { expect, test } from '@playwright/test';

/**
 * El circuito médico completo, con dos personas: recepción agenda la cita y marca la llegada;
 * la veterinaria (usuaria nueva, primer ingreso) atiende con SOAP, aplica una vacuna, emite la
 * receta, toma el consentimiento firmado en pantalla y cierra; recepción cobra.
 * Usa el administrador del seed (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) como recepción.
 */
const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@uywa.pe';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'Pruebas2026clave';
const stamp = Date.now().toString().slice(-6);
const owner = `Dueña E2E ${stamp}`;
const pet = `Michi${stamp}`;
const service = `Consulta médica E2E ${stamp}`;
const vetName = `Dra. Prueba ${stamp}`;
const vetEmail = `vet${stamp}@uywa.pe`;
/** La veterinaria de prueba se desactiva al terminar: no se acumulan en la agenda de la demo */
let vetId: number | null = null;

test.afterEach(async ({ page }) => {
  if (vetId) await page.request.patch(`/api/users/${vetId}`, { data: { active: false } });
  vetId = null;
});

/** Próximo horario de la agenda (cada 15 min, 07:00–21:45) que todavía no pasó, en hora de Lima */
function nextSlot(): string | null {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Lima',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .split(':')
    .map(Number);
  const start = Math.max(7 * 60, Math.ceil((h * 60 + m) / 15) * 15);
  if (start > 21 * 60 + 45) return null;
  return `${String(Math.floor(start / 60)).padStart(2, '0')}:${String(start % 60).padStart(2, '0')}`;
}

test('consulta completa: cita → llegada → SOAP → vacuna → receta → consentimiento → cobro', async ({
  page,
  browser,
}) => {
  const slot = nextSlot();
  test.skip(!slot, 'La agenda del día ya terminó (después de las 21:45 en Lima)');

  // ── Recepción ingresa ──
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);

  // Datos de base: servicio, veterinaria con colegiatura y cliente con su gata
  expect(
    (
      await page.request.post('/api/care-services', {
        data: { name: service, category: 'CONSULTATION', price: 60 },
      })
    ).ok(),
  ).toBeTruthy();
  const vet = await page.request.post('/api/users', {
    data: { fullName: vetName, email: vetEmail, role: 'VET', licenseNumber: `CMVP-${stamp}` },
  });
  expect(vet.ok()).toBeTruthy();
  const created = (await vet.json()) as { user: { id: number }; temporaryPassword: string };
  vetId = created.user.id;
  const { temporaryPassword } = created;
  const client = await page.request.post('/api/clients', {
    data: { name: owner, phone: '987654321', consent: true, pet: { name: pet, species: 'CAT' } },
  });
  expect(client.ok()).toBeTruthy();
  const petId = ((await client.json()) as { pets: { id: number }[] }).pets[0].id;

  // ── Recepción agenda la cita para hoy con la veterinaria ──
  await page.goto(
    `/citas?nueva=1&petId=${petId}&mascota=${encodeURIComponent(pet)}&cliente=${encodeURIComponent(owner)}`,
  );
  const form = page.locator('dialog[open]');
  await expect(form).toContainText(pet);
  await form.locator('#appt-time').selectOption(slot!);
  await form.locator('#appt-vet').selectOption({ label: vetName });
  await form.locator('#appt-reason').fill('Vacuna anual y control de cojera');
  await form.getByRole('button', { name: 'Agendar', exact: true }).click();
  await expect(page.getByText(`Cita de ${pet} agendada.`)).toBeVisible();

  // Llega a la clínica: pasa a la cola
  await page.getByRole('button', { name: new RegExp(`${pet}, Por confirmar`) }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^Llegó/ })
    .click();
  await expect(page.getByText(/pasó a la cola/i)).toBeVisible();

  // ── La veterinaria entra por primera vez y cambia su clave ──
  const vetContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
  });
  const vp = await vetContext.newPage();
  await vp.goto('/login');
  await vp.locator('#email').fill(vetEmail);
  await vp.locator('#password').fill(temporaryPassword);
  await vp.locator('button[type="submit"]').click();
  await expect(vp).toHaveURL(/cambiar-clave/);
  await vp.locator('#current').fill(temporaryPassword);
  await vp.locator('#next').fill(`Veterinaria${stamp}`);
  await vp.locator('#confirm').fill(`Veterinaria${stamp}`);
  await vp.locator('button[type="submit"]').click();
  await expect(vp).toHaveURL(/dashboard/);

  // ── Atiende desde la cola ──
  await vp.goto('/cola');
  const card = vp.locator(`article[aria-label^="${pet}"]`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Atender' }).click();
  await expect(vp).toHaveURL(/\/atenciones\/\d+$/);
  const visitUrl = vp.url();

  // SOAP
  await vp.locator('#v-anamnesis').fill('Cojea del miembro posterior derecho hace 3 días.');
  await vp.locator('#v-weight').fill('4.2');
  await vp.locator('#v-temp').fill('38.6');
  await vp.locator('#v-exam').fill('Dolor a la palpación de la rodilla derecha, sin edema.');
  await vp.locator('#v-dx').fill('Esguince de rodilla');
  // Se guarda solo al dejar de escribir
  await expect(vp.getByRole('status').filter({ hasText: /^Guardado/ })).toBeVisible();

  // Vacuna con su refuerzo
  await vp.getByRole('button', { name: 'Aplicar' }).click();
  const vaccine = vp.locator('app-immunization-form');
  await vaccine.locator('input[formcontrolname="name"]').fill('Triple felina');
  await vaccine.getByRole('button', { name: '1 año' }).click();
  await vaccine.getByRole('button', { name: 'Registrar' }).click();
  await expect(vp.getByText('Se agregó Triple felina al carnet.')).toBeVisible();

  // Receta con un medicamento escrito a mano
  await vp.getByRole('button', { name: 'Nueva receta' }).click();
  await vp.locator('#rx-search').fill('Meloxicam 0.5 mg/ml');
  await vp.locator('#rx-search').press('Enter');
  await vp.locator('#rx-dose-0').fill('0.2 ml');
  await vp.locator('#rx-freq-0').fill('Cada 24 horas');
  await vp.locator('#rx-dur-0').fill('5 días');
  await vp.getByRole('button', { name: 'Emitir receta' }).click();
  await expect(vp.getByText(/Receta RX-\d+ emitida/)).toBeVisible();

  // Cargo de la consulta
  await vp.locator('#v-search').fill(service);
  await vp.locator('#v-results').getByText(service).click();
  await vp.getByRole('button', { name: /^Registrar cargo/ }).click();
  await expect(vp.getByText('Cargo registrado.')).toBeVisible();

  // ── Consentimiento firmado en pantalla ──
  await vp.locator('app-pet-documents').getByRole('link', { name: 'Consentimiento' }).click();
  await expect(vp).toHaveURL(/consentimiento\?atencion=\d+/);
  await vp.locator('button[data-value="ANESTHESIA"]').click();
  await vp.locator('#c-procedure').fill('Radiografía de rodilla con sedación');
  await vp.getByRole('button', { name: 'Preparar texto' }).click();
  await expect(vp.locator('#c-text')).toHaveValue(new RegExp(`Yo, ${owner}`));
  const pad = vp.locator('app-signature-pad canvas');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  await vp.mouse.move(box.x + 40, box.y + 100);
  await vp.mouse.down();
  for (let i = 1; i <= 30; i++)
    await vp.mouse.move(box.x + 40 + i * 8, box.y + 100 + Math.sin(i / 3) * 25);
  await vp.mouse.up();
  await vp.locator('input[formcontrolname="read"]').check();
  await vp.getByRole('button', { name: 'Guardar consentimiento firmado' }).click();
  await expect(vp).toHaveURL(/\/consentimientos\/\d+$/);
  const consent = vp.locator('article.print-sheet');
  await expect(consent).toContainText(/CI-\d{5}/);
  await expect(consent).toContainText(owner);
  await expect(consent).toContainText(`C.M.V.P. CMVP-${stamp}`);
  await expect(consent).toContainText('SHA-256');

  // ── Cierra la atención ──
  await vp.goto(visitUrl);
  await vp.getByRole('button', { name: 'Cerrar atención' }).first().click();
  const confirm = vp.locator('dialog[open]');
  await expect(confirm).toContainText('S/ 60.00');
  await confirm.getByRole('button', { name: 'Cerrar atención' }).click();
  await expect(vp.getByText('Cerrada', { exact: true })).toBeVisible();
  await vetContext.close();

  // ── Recepción cobra ──
  await page.goto(visitUrl.replace(/^https?:\/\/[^/]+/, ''));
  await page.getByRole('link', { name: /^Cobrar S\/ 60\.00/ }).click();
  await expect(page).toHaveURL(/\/caja/);
  const openAmount = page.locator('#open-amount');
  if (await openAmount.isVisible().catch(() => false)) {
    await openAmount.fill('100');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  const collect = page.locator('dialog[open]');
  await expect(collect).toContainText(`Cobrar a ${owner}`);
  const note = collect.getByRole('radio', { name: 'Nota de venta' });
  if (await note.count()) await note.click();
  await collect.locator('#collect-tendered-0').fill('60');
  await collect.getByRole('button', { name: /^Cobrar S\// }).click();
  await expect(page).toHaveURL(/\/caja\/tickets\/\d+$/);
  await expect(page.locator('.print-area')).toContainText(service);

  // ── La historia clínica queda completa ──
  await page.goto(`/mascotas/${petId}`);
  await expect(page.getByText('Esguince de rodilla')).toBeVisible();
  await expect(page.locator('app-immunization-list').getByText('Triple felina')).toBeVisible();
  // El resumen del carnet anuncia el próximo refuerzo
  await expect(page.getByText(/Próximo refuerzo:\s*Triple felina/)).toBeVisible();
  await expect(page.locator('app-pet-documents')).toContainText('Anestesia o sedación');
});
