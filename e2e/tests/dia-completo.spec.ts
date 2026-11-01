import { expect, test } from '@playwright/test';

/**
 * Un día de clínica sin papel: se registra un cliente con su mascota, pasa por la cola,
 * se atiende con un servicio, se cobra con vuelto y se cierra la caja cuadrando.
 * Usa el administrador del seed (SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD).
 */
const EMAIL = process.env['E2E_EMAIL'] ?? 'admin@uywa.pe';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'CambiaEstaClave123';
const stamp = Date.now().toString().slice(-6);
const owner = `Cliente E2E ${stamp}`;
const pet = `Firulais${stamp}`;
const service = `Consulta E2E ${stamp}`;

test('día completo: recepción → atención → cobro → cierre de caja', async ({ page }) => {
  // ── Ingreso ──
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);

  // Servicio del catálogo para cobrar (precio con IGV)
  const created = await page.request.post('/api/care-services', {
    data: { name: service, category: 'CONSULTATION', price: 50 },
  });
  expect(created.ok()).toBeTruthy();

  // ── Recepción: cliente + mascota, directo a la cola ──
  await page.goto('/clientes/nuevo');
  await page.getByText('Sin documento', { exact: true }).click();
  await page.locator('#c-name').fill(owner);
  await page.locator('#c-phone').fill('987654321');
  await page.locator('#new-pet-name').fill(pet);
  await page.getByText('Perro', { exact: true }).first().click();
  await page.locator('input[formcontrolname="consent"]').check();
  await page.getByRole('button', { name: 'Guardar y poner en cola' }).click();
  await expect(page).toHaveURL(/\/clientes\/\d+$/);

  // ── Cola: atender ──
  await page.goto('/cola');
  const card = page.locator(`article[aria-label^="${pet}"]`);
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Atender' }).click();
  await expect(page).toHaveURL(/\/atenciones\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(pet);

  // ── Atención: signos, servicio y cierre ──
  await page.locator('#v-weight').fill('12.4');
  await page.locator('#v-notes').fill('Control general. Sin hallazgos.');
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText('Atención guardada.')).toBeVisible();

  await page.locator('#v-search').fill(service);
  await page.locator('#v-results').getByText(service).click();
  await page.getByRole('button', { name: /^Registrar cargo/ }).click();
  await expect(page.getByText('Cargo registrado.')).toBeVisible();

  await page.getByRole('button', { name: 'Cerrar atención' }).first().click();
  const confirm = page.locator('dialog[open]');
  await expect(confirm).toContainText('S/ 50.00');
  await confirm.getByRole('button', { name: 'Cerrar atención' }).click();
  await expect(page.getByText('Cerrada', { exact: true })).toBeVisible();

  // ── Caja: abrir si hace falta y cobrar con vuelto ──
  await page.getByRole('link', { name: /^Cobrar S\/ 50\.00/ }).click();
  await expect(page).toHaveURL(/\/caja/);
  const openAmount = page.locator('#open-amount');
  if (await openAmount.isVisible().catch(() => false)) {
    await openAmount.fill('100');
    await page.getByRole('button', { name: 'Abrir caja' }).click();
  }
  const collect = page.locator('dialog[open]');
  await expect(collect).toContainText(`Cobrar a ${owner}`);
  // Con comprobantes electrónicos activos, este recorrido emite la nota de venta interna
  const note = collect.getByRole('radio', { name: 'Nota de venta' });
  if (await note.count()) await note.click();
  await collect.locator('#collect-tendered-0').fill('100');
  await expect(collect).toContainText('Vuelto S/ 50.00');
  await collect.getByRole('button', { name: /^Cobrar S\// }).click();

  // ── Ticket ──
  await expect(page).toHaveURL(/\/caja\/tickets\/\d+$/);
  const ticket = page.locator('.print-area');
  await expect(ticket).toContainText(/NV-\d{6}/);
  await expect(ticket).toContainText(owner);
  await expect(ticket).toContainText('Vuelto');
  await expect(ticket).toContainText('no es comprobante de pago');

  // ── Cierre de caja cuadrando ──
  await page.goto('/caja');
  await expect(page.getByRole('heading', { name: 'Por cobrar' })).toBeVisible();
  await page.getByRole('button', { name: 'Cerrar caja' }).click();
  const close = page.locator('dialog[open]');
  const expected = (await close.locator('p.font-display').textContent())!.replace(/[^\d.]/g, '');
  await close.locator('#close-counted').fill(expected);
  await expect(close).toContainText('Cuadra exacto');
  await close.getByRole('button', { name: 'Cerrar caja' }).click();
  await expect(page.getByText('La caja está cerrada')).toBeVisible();
  await expect(page.getByText('Cuadra', { exact: true })).toBeVisible();
});
