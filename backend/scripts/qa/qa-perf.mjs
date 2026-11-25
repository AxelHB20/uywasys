// QA de rendimiento: tiempo de cada pantalla principal con la clínica de volumen (3 años).
const API = 'http://localhost:3000/api';
const email = process.env.EMAIL;
const r = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ email, password: 'Demo2026clave' }),
});
if (r.status !== 200) throw new Error('login ' + r.status + (await r.text()));
const cookie = r.headers.get('set-cookie').split(';')[0];
const today = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
const m1 = today.slice(0, 8) + '01';
const paths = (
  process.env.PATHS ??
  `
/dashboard
/queue
/clients?q=quispe
/clients?q=40001234
/clients
/pets?q=toby
/visits
/visits?q=toby
/appointments?from=${today}&to=${today}
/immunizations/due
/cash/pending
/cash/session
/cash/receipts
/billing/documents?from=${m1}&to=${today}
/billing/documents
/billing/documents?q=40001234
/reports/sales?from=${m1}&to=${today}
/reports/sales?from=2025-11-01&to=${today}
/activity
/inventory/products
/inventory/alerts
/hospitalizations
/grooming/board
/notifications
/billing/report?from=${m1}&to=${today}
`
)
  .trim()
  .split('\n');
const rows = [];
for (const p of paths) {
  const times = [];
  let status = 0,
    size = 0;
  for (let i = 0; i < 3; i++) {
    const t = performance.now();
    const res = await fetch(API + p, { headers: { cookie } });
    const buf = await res.arrayBuffer();
    times.push(performance.now() - t);
    status = res.status;
    size = buf.byteLength;
  }
  times.sort((a, b) => a - b);
  rows.push({
    p,
    status,
    ms: Math.round(times[1]),
    kb: Math.round(size / 1024),
  });
}
for (const x of rows)
  console.log(
    String(x.ms).padStart(6),
    'ms',
    String(x.status).padStart(4),
    String(x.kb).padStart(5),
    'KB ',
    x.p,
    x.ms > 300 ? '  ← LENTO' : '',
  );
