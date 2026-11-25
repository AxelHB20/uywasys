// Matriz QA de permisos: rutas sensibles por rol (esperado = roles que deben poder).
const API = 'http://localhost:3000/api';
const roles = {
  ADMIN: 'admin',
  VET: 'vet',
  RECEPTION: 'reception',
  GROOMER: 'groomer',
  CASHIER: 'cashier',
};
const cookies = {};
for (const [role, u] of Object.entries(roles)) {
  const r = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: `${u}@huellitas.pe`,
      password: 'Demo2026clave',
    }),
  });
  cookies[role] = r.headers.get('set-cookie')?.split(';')[0];
}
const checks = [
  ['GET', '/users', ['ADMIN']],
  ['GET', '/activity', ['ADMIN']],
  ['GET', '/billing/settings', ['ADMIN']],
  ['GET', '/reports/sales?from=2026-10-01&to=2026-10-31', ['ADMIN']],
  ['GET', '/billing/report?from=2026-10-01&to=2026-10-31', ['ADMIN']],
  ['PATCH', '/clinic', ['ADMIN'], {}],
  ['POST', '/users', ['ADMIN'], {}],
  ['POST', '/inventory/products', ['ADMIN', 'VET', 'RECEPTION'], {}],
  ['POST', '/cash/sessions/open', ['ADMIN', 'RECEPTION', 'CASHIER'], {}],
  ['POST', '/prescriptions', ['ADMIN', 'VET'], {}],
  ['POST', '/visits/1/prescriptions', ['ADMIN', 'VET'], {}],
  ['POST', '/immunizations', ['ADMIN', 'VET'], {}],
  ['POST', '/hospitalizations', ['ADMIN', 'VET'], {}],
];
let bad = 0;
for (const [m, path, allowed, body] of checks) {
  const row = [];
  for (const role of Object.keys(roles)) {
    const r = await fetch(API + path, {
      method: m,
      headers: { cookie: cookies[role], 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const denied = r.status === 403;
    const should = allowed.includes(role);
    const ok = should ? !denied && r.status !== 401 : denied;
    if (!ok) bad++;
    row.push(`${role}:${r.status}${ok ? '' : '✗'}`);
  }
  console.log(m.padEnd(5), path.padEnd(55), row.join(' '));
}
console.log(
  bad ? `${bad} diferencias con lo esperado` : 'Permisos como se espera',
);
