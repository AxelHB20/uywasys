import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

/**
 * Cierre de la Fase 7: cada número del inicio y de los reportes coincide con su módulo de
 * origen. Un cobro aparece igual en la caja, el inicio y Reportes; anularlo lo saca de todos y
 * lo vendido queda por cobrar.
 */
const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@uywa.pe';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'Pruebas2026clave';
const stamp = Date.now().toString().slice(-6);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const money = (n: number) =>
  `S/ ${new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;

interface Kpis {
  sold: number;
  pending: number;
  collected: number;
}

test('los números cuadran entre caja, inicio y reportes', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);

  const api = async <T>(method: 'get' | 'post', url: string, data?: object): Promise<T> => {
    const res = await page.request[method](`/api${url}`, data ? { data } : undefined);
    expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };
  const report = async () =>
    (await api<{ kpis: Kpis }>('get', `/reports/sales?from=${today}&to=${today}`)).kpis;
  const cashToday = async () =>
    (await api<{ sales: { total: number } }>('get', '/dashboard')).sales.total;

  const before = await report();
  expect(await cashToday()).toBe(before.collected);

  // Una consulta de S/ 80 y un cobro parcial de S/ 50 con Yape
  const service = await api<{ id: number }>('post', '/care-services', {
    name: `Consulta cuadre ${stamp}`,
    category: 'CONSULTATION',
    price: 80,
  });
  const client = await api<{ id: number }>('post', '/clients', {
    name: `Dueño Cuadre ${stamp}`,
    phone: '987654321',
    consent: true,
  });
  await api('post', '/charges', {
    clientId: client.id,
    items: [{ careServiceId: service.id, quantity: 1 }],
  });
  const opened = await page.request.post('/api/cash/sessions', { data: { openingAmount: 100 } });
  expect([201, 409]).toContain(opened.status());
  const receipt = await api<{ id: number }>('post', '/cash/receipts', {
    requestKey: randomUUID(),
    clientId: client.id,
    amount: 50,
    payments: [{ method: 'YAPE', amount: 50, operationCode: stamp }],
  });

  const after = await report();
  expect(after.sold).toBeCloseTo(before.sold + 80, 2);
  expect(after.collected).toBeCloseTo(before.collected + 50, 2);
  expect(after.pending).toBeCloseTo(before.pending + 30, 2);
  expect(await cashToday()).toBe(after.collected);

  // En pantalla: inicio (ventas de hoy y el mes) y Reportes, con los mismos montos
  await page.goto('/dashboard');
  await expect(page.locator('li', { hasText: 'Cobrado hoy' })).toContainText(
    money(after.collected),
  );
  const month = await api<{ kpis: Kpis }>('get', '/reports/month');
  await expect(page.locator('section', { hasText: 'Cobrado en' }).first()).toContainText(
    money(month.kpis.collected),
  );

  await page.goto('/reportes');
  await page.getByRole('radio', { name: 'Hoy', exact: true }).click();
  const kpi = (label: string) => page.locator('ul[aria-label="Indicadores del período"] li', { hasText: label });
  await expect(kpi('Vendido')).toContainText(money(after.sold));
  await expect(kpi('Cobrado')).toContainText(money(after.collected));
  await expect(kpi('Vendido')).toContainText(`${money(after.pending)} por cobrar`);

  // Anular el cobro: sale de lo cobrado en todos lados; lo vendido sigue, ahora por cobrar
  await api('post', `/cash/receipts/${receipt.id}/void`, { reason: 'Prueba de cuadre' });
  const voided = await report();
  expect(voided.collected).toBeCloseTo(before.collected, 2);
  expect(voided.sold).toBeCloseTo(after.sold, 2);
  expect(voided.pending).toBeCloseTo(before.pending + 80, 2);
  expect(await cashToday()).toBe(voided.collected);

  await page.reload();
  await page.getByRole('radio', { name: 'Hoy', exact: true }).click();
  await expect(kpi('Cobrado')).toContainText(money(voided.collected));
});
