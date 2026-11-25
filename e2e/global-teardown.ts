import { request, type FullConfig } from '@playwright/test';

/**
 * Al terminar, desactiva lo que crearon las pruebas para que no se acumule en la demo:
 * clientes "E2E" (y sus mascotas), servicios, productos y proveedores "E2E" y los usuarios de prueba.
 * Solo desactiva (no borra): lo cobrado y lo firmado sigue intacto. Nunca falla la corrida.
 */
const TEST_NAME = /\bE2E\b|^(Dra\. Prueba|Groomer Prueba) \d+$/;

export default async function globalTeardown(config: FullConfig): Promise<void> {
  const baseURL = config.projects[0]?.use.baseURL ?? 'http://localhost:4200';
  const api = await request.newContext({ baseURL });
  try {
    const login = await api.post('/api/auth/login', {
      data: {
        email: process.env['E2E_EMAIL'] ?? 'e2e@uywa.pe',
        password: process.env['E2E_PASSWORD'] ?? 'Pruebas2026clave',
      },
    });
    if (!login.ok()) return;

    // Primero se juntan (desactivar mientras se pagina movería las páginas), luego se desactivan
    const found: { id: number; pets: { id: number }[] }[] = [];
    for (let page = 1; page <= 40; page++) {
      const res = await api.get('/api/clients', {
        params: { q: 'E2E', page, pageSize: 50, status: 'active' },
      });
      if (!res.ok()) break;
      const body = (await res.json()) as {
        items: { id: number; name: string; pets: { id: number }[] }[];
        total: number;
        pageSize: number;
      };
      found.push(...body.items.filter((c) => TEST_NAME.test(c.name)));
      if (page * body.pageSize >= body.total) break;
    }
    for (const c of found) {
      for (const p of c.pets) await api.patch(`/api/pets/${p.id}`, { data: { active: false } });
      await api.patch(`/api/clients/${c.id}`, { data: { active: false } });
    }

    const services = await api.get('/api/care-services', { params: { status: 'active' } });
    if (services.ok())
      for (const s of (await services.json()) as { id: number; name: string }[])
        if (TEST_NAME.test(s.name))
          await api.patch(`/api/care-services/${s.id}`, { data: { active: false } });

    const products: { id: number; name: string }[] = [];
    for (let page = 1; page <= 20; page++) {
      const res = await api.get('/api/inventory/products', { params: { q: 'E2E', page } });
      if (!res.ok()) break;
      const body = (await res.json()) as {
        items: { id: number; name: string }[];
        total: number;
        pageSize: number;
      };
      products.push(...body.items.filter((p) => TEST_NAME.test(p.name)));
      if (page * body.pageSize >= body.total) break;
    }
    for (const p of products)
      await api.patch(`/api/inventory/products/${p.id}`, { data: { active: false } });

    const suppliers = await api.get('/api/inventory/suppliers', { params: { q: 'E2E' } });
    if (suppliers.ok())
      for (const s of (await suppliers.json()) as { id: number; name: string; active: boolean }[])
        if (s.active !== false && TEST_NAME.test(s.name))
          await api.patch(`/api/inventory/suppliers/${s.id}`, { data: { active: false } });

    const users = await api.get('/api/users');
    if (users.ok())
      for (const u of (await users.json()) as { id: number; fullName: string; active: boolean }[])
        if (u.active && TEST_NAME.test(u.fullName))
          await api.patch(`/api/users/${u.id}`, { data: { active: false } });
  } catch {
    // La limpieza es una cortesía: si falla, la corrida igual cuenta
  } finally {
    await api.dispose();
  }
}
