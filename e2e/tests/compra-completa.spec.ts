import { expect, test } from '@playwright/test';

/**
 * Compras: la ficha del proveedor se pasa al sistema → el stock entra con su lote y costo sin
 * IGV → se vende → el margen usa el costo de esa compra. Y la misma ficha no entra dos veces.
 */
const EMAIL = process.env['E2E_EMAIL'] ?? 'e2e@uywa.pe';
const PASSWORD = process.env['E2E_PASSWORD'] ?? 'Pruebas2026clave';
const stamp = Date.now().toString().slice(-6);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date());
const inDays = (days: number) => {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

interface Product {
  id: number;
  totalStock: number;
  presentations: { id: number; name: string; factor: number }[];
  batches: { lotNumber: string | null; unitCost: number | null; purchase?: { code: string } }[];
}

test('compra completa: ficha → stock con lote y costo → venta → margen', async ({ page }) => {
  await page.goto('/login');
  await page.locator('#email').fill(EMAIL);
  await page.locator('#password').fill(PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page).toHaveURL(/dashboard/);
  await page.evaluate(() => localStorage.clear());

  const api = async <T>(method: 'get' | 'post', url: string, data?: object): Promise<T> => {
    const res = await page.request[method](`/api${url}`, data ? { data } : undefined);
    expect(res.ok(), `${method.toUpperCase()} ${url} → ${res.status()}`).toBeTruthy();
    return (await res.json()) as T;
  };

  const name = `Cefalexina E2E ${stamp}`;
  const product = await api<Product>('post', '/inventory/products', {
    name,
    category: 'MEDICINE',
    baseUnit: 'TABLET',
    minStock: 10,
    presentations: [
      { name: 'Caja x 10', factor: 10, price: 50 },
      { name: 'Tableta', factor: 1, price: 6 },
    ],
  });
  const supplier = `Proveedor E2E ${stamp}`;
  await api('post', '/inventory/suppliers', { name: supplier });

  // ── La ficha, tal como viene ──
  await page.goto('/inventario/compras/nueva');
  await page.locator('#pf-supplier').selectOption({ label: supplier });
  await page.locator('#pf-number').fill(`F001-${stamp}`);
  await page.locator('#pl-search').fill(name);
  await expect(page.getByRole('option', { name: new RegExp(name) })).toBeVisible();
  await page.locator('#pl-search').press('Enter');
  await page.locator('#pl-qty-0').fill('2');
  await page.locator('#pl-pres-0').selectOption({ label: 'Caja x 10' });
  await page.locator('#pl-lot-0').fill(`CX-${stamp}`);
  await page.locator('#pl-exp-0').fill(inDays(400));
  await page.locator('#pl-price-0').fill('30');
  await expect(page.getByText('Entran 20 tabletas')).toBeVisible();
  // 2 cajas × 30 sin IGV = 60 + IGV 10.80
  await page.locator('#pf-paper').fill('70.80');
  await expect(page.getByText('Cuadra con la ficha')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar compra' }).click();

  await expect(page).toHaveURL(/\/inventario\/compras\/\d+$/);
  await expect(page.getByRole('heading', { level: 1 })).toContainText(`Factura F001-${stamp}`);
  await expect(page.getByText('S/ 70.80').first()).toBeVisible();

  // ── El stock entró con su lote, su costo sin IGV y sabe de qué ficha vino ──
  const after = await api<Product>('get', `/inventory/products/${product.id}`);
  expect(after.totalStock).toBe(20);
  expect(after.batches[0]).toMatchObject({ lotNumber: `CX-${stamp}`, unitCost: 3 });
  expect(after.batches[0].purchase?.code).toMatch(/^CO-\d{5}$/);

  // ── La misma ficha no entra dos veces ──
  const repeated = await page.request.post('/api/inventory/purchases', {
    data: {
      supplierId: (
        await api<{ id: number; name: string }[]>('get', `/inventory/suppliers?q=${stamp}`)
      )[0].id,
      docType: 'FACTURA',
      docNumber: `f001-${Number(stamp)}`,
      issuedAt: today,
      pricesIncludeIgv: false,
      lines: [
        {
          productId: product.id,
          presentationId: product.presentations.find((p) => p.factor === 10)!.id,
          quantity: 1,
          unitPrice: 30,
          lotNumber: 'X',
          expiresAt: inDays(300),
        },
      ],
    },
  });
  expect(repeated.status()).toBe(409);

  // ── Se vende y el margen usa el costo de la compra ──
  const client = await api<{ id: number }>('post', '/clients', {
    name: `Dueño Compra ${stamp}`,
    phone: '987654321',
    consent: true,
  });
  await api('post', '/charges', {
    clientId: client.id,
    items: [
      {
        productId: product.id,
        presentationId: product.presentations.find((p) => p.factor === 1)!.id,
        quantity: 5,
      },
    ],
  });
  expect((await api<Product>('get', `/inventory/products/${product.id}`)).totalStock).toBe(15);
  const margin = await api<{ products: { name: string; cost: number | null; revenue: number }[] }>(
    'get',
    `/reports/margin?from=${today}&to=${today}`,
  );
  const row = margin.products.find((r) => r.name === name);
  // 5 tabletas a S/ 3 (costo sin IGV de la ficha)
  expect(row?.cost).toBeCloseTo(15, 2);
  expect(row?.revenue).toBeCloseTo(25.42, 2);

  // ── En el historial de compras aparece con su total ──
  await page.goto('/inventario/compras');
  await expect(page.getByRole('link', { name: new RegExp(`F001-${stamp}`) })).toContainText(
    'S/ 70.80',
  );
});
