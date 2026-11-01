import { expect, test } from '@playwright/test';

/**
 * Un servicio de grooming completo, con dos personas: recepción ingresa a la mascota con su
 * checklist; el groomer (usuario nuevo, primer ingreso) la avanza en el tablero hasta "Listo";
 * recepción la entrega, cobra en caja, y la constancia y las comisiones quedan al día.
 * Usa el administrador del seed (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD) como recepción.
 */
const EMAIL = process.env['E2E_EMAIL'] ?? 'admin@uywa.pe';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'CambiaEstaClave123';
const stamp = Date.now().toString().slice(-6);
const owner = `Dueño Grooming ${stamp}`;
const pet = `Peluchin${stamp}`;
const bath = `Baño E2E ${stamp}`;
const nails = `Uñas E2E ${stamp}`;
const groomerName = `Groomer Prueba ${stamp}`;
const groomerEmail = `groomer${stamp}@uywa.pe`;

test('día de grooming: ingreso → tablero → entrega → cobro → constancia y comisión', async ({
  page,
  browser,
}) => {
  // ── Recepción ingresa ──
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);

  // Catálogo con precio por tamaño, groomer con 25 % de comisión y un cliente con su perro
  const service = async (data: object) => {
    const res = await page.request.post('/api/care-services', { data });
    expect(res.ok()).toBeTruthy();
    return ((await res.json()) as { id: number }).id;
  };
  const bathId = await service({
    name: bath,
    category: 'GROOMING',
    price: 35,
    sizePrices: [{ size: 'MEDIUM', price: 45 }],
  });
  const nailsId = await service({ name: nails, category: 'GROOMING', price: 10 });
  const groomer = await page.request.post('/api/users', {
    data: { fullName: groomerName, email: groomerEmail, role: 'GROOMER', commissionPercent: 25 },
  });
  expect(groomer.ok()).toBeTruthy();
  const { temporaryPassword } = (await groomer.json()) as { temporaryPassword: string };
  const client = await page.request.post('/api/clients', {
    data: {
      name: owner,
      phone: '987654321',
      consent: true,
      pet: { name: pet, species: 'DOG', breed: 'Shih tzu', weightKg: 14 },
    },
  });
  expect(client.ok()).toBeTruthy();
  const petId = ((await client.json()) as { pets: { id: number }[] }).pets[0].id;

  // ── Ingreso con checklist (el tamaño sale del peso: mediano) ──
  await page.goto(`/grooming/ingreso?petId=${petId}`);
  await expect(page.locator('[data-size="MEDIUM"]')).toHaveAttribute('aria-checked', 'true');
  await page.locator(`[data-service="${bathId}"]`).click();
  await page.locator(`[data-service="${nailsId}"]`).click();
  await page.getByRole('checkbox', { name: 'Nudos' }).click();
  await page.locator('#gr-belongings').fill('Collar rojo');
  await page.locator('#gr-instructions').fill('Corte cachorro, sin perfume');
  await page.locator('#gr-groomer').selectOption({ label: groomerName });
  await page.getByRole('button', { name: /^Registrar ingreso · S\/ 55\.00/ }).click();
  await expect(page).toHaveURL(/\/grooming$/);
  await expect(page.getByText(new RegExp(`${pet} ingresó al tablero`))).toBeVisible();

  // ── El groomer entra por primera vez y avanza la tarjeta ──
  const groomerContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    locale: 'es-PE',
    timezoneId: 'America/Lima',
  });
  const gp = await groomerContext.newPage();
  await gp.goto('/login');
  await gp.locator('#email').fill(groomerEmail);
  await gp.locator('#password').fill(temporaryPassword);
  await gp.locator('button[type="submit"]').click();
  await expect(gp).toHaveURL(/cambiar-clave/);
  await gp.locator('#current').fill(temporaryPassword);
  await gp.locator('#next').fill(`Groomer${stamp}`);
  await gp.locator('#confirm').fill(`Groomer${stamp}`);
  await gp.locator('button[type="submit"]').click();
  await expect(gp).toHaveURL(/dashboard/);

  await gp.goto('/grooming');
  const card = gp.locator(`li[aria-label^="${pet},"]`);
  await expect(card).toHaveAttribute('aria-label', `${pet}, En espera`);
  await expect(card).toContainText('Nudos');
  await expect(card).toContainText(`${bath} (mediano)`);
  for (const [step, label] of [
    ['Baño', 'Baño'],
    ['Corte', 'Corte'],
    ['Listo', 'Listo'],
  ]) {
    await card.getByRole('button', { name: `Pasar a ${step}` }).click();
    await expect(card).toHaveAttribute('aria-label', `${pet}, ${label}`);
  }
  // Listo: aviso por WhatsApp con el total
  const whatsapp = card.getByRole('link', { name: new RegExp(`Avisar por WhatsApp a ${owner}`) });
  await expect(whatsapp).toHaveAttribute('href', /wa\.me\/51987654321\?text=.*S%2F%2055\.00/);

  // ── Recepción entrega y cobra ──
  await page.reload();
  const ready = page.locator(`li[aria-label="${pet}, Listo"]`);
  await ready.getByRole('button', { name: 'Entregar' }).click();
  const deliver = page.locator('dialog[open]');
  await expect(deliver).toContainText(`Entregar a ${pet}`);
  await expect(page.locator('#dl-name')).toHaveValue(owner);
  await deliver.getByRole('button', { name: 'Entregar', exact: true }).click();
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
  await expect(collect).toContainText('Vuelto S/ 5.00');
  await collect.getByRole('button', { name: /^Cobrar S\// }).click();
  await expect(page).toHaveURL(/\/caja\/tickets\/\d+$/);
  await expect(page.locator('.print-area')).toContainText(`${bath} (mediano)`);

  // ── La constancia guarda cómo llegó y quién la recogió ──
  await page.goto('/grooming');
  await page.getByRole('button', { name: new RegExp(`${pet} · `) }).click();
  await page.locator('dialog[open]').getByRole('link', { name: 'Constancia' }).click();
  const certificate = page.locator('article.print-sheet');
  await expect(certificate).toContainText(/GR-\d{5}/);
  await expect(certificate).toContainText('Nudos: Sí');
  await expect(certificate).toContainText('Collar rojo');
  await expect(certificate).toContainText('Corte cachorro, sin perfume');
  await expect(certificate).toContainText(`Recogió`);
  await expect(certificate).toContainText('S/ 55.00');

  // ── El groomer ve su comisión: 25 % de lo cobrado ──
  await gp.goto('/grooming/comisiones');
  await expect(gp.getByRole('heading', { name: 'Mis comisiones' })).toBeVisible();
  await expect(gp.locator('#contenido')).toContainText(`${pet} · ${bath} (mediano)`);
  await expect(gp.locator('#contenido')).toContainText('S/ 13.75');
  await groomerContext.close();
});
