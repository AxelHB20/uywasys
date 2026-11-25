// Barrido QA: con sesión de la clínica A, toca cada ruta con IDs de la clínica B. Nada debe responder 2xx.
import pg from 'pg';
const API = 'http://localhost:3000/api';
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const B = Number(process.env.CLINIC_B);
const one = async (table, extra = '') =>
  (
    await db.query(
      `select id from ${table} where clinic_id = $1 ${extra} order by id desc limit 1`,
      [B],
    )
  ).rows[0]?.id;
const ids = {
  pet: await one('pets'),
  client: await one('clients', 'and walk_in = false'),
  consent: await one('consents'),
  grooming: await one('grooming_sessions'),
  attachment: await one('attachments'),
  rx: await one('prescriptions'),
  receipt: await one('receipts'),
  session: await one('cash_sessions'),
  estimate: await one('estimates'),
  hosp: await one('hospitalizations'),
  product: await one('products'),
  visit: await one('visits'),
  template: await one('clinical_templates'),
  appt: await one('appointments'),
  service: await one('care_services'),
  presentation: await one('product_presentations'),
  queue: await one('queue_entries'),
  user: await one('users'),
  doc: await one('electronic_documents'),
  expense: await one('cash_movements'),
  charge: await one('charges'),
  imm: await one('immunizations'),
  shortage: await one('stock_shortages'),
  person: await one('authorized_people'),
};
const order =
  (
    await db.query(
      'select id from hospitalization_orders where hospitalization_id=$1 limit 1',
      [ids.hosp],
    )
  ).rows[0]?.id ?? 1;
const login = await fetch(`${API}/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: process.env.EMAIL,
    password: process.env.PASSWORD,
  }),
});
const cookie = login.headers.get('set-cookie').split(';')[0];
const body = {
  reason: 'QA aislamiento entre clínicas',
  status: 'CANCELLED',
  name: 'QA',
  quantity: 1,
  notes: 'qa',
  text: 'qa',
  active: false,
  groomerId: ids.user,
  presentationId: ids.presentation,
  factor: 1,
  price: 1,
  counts: [],
  items: [],
  kind: 'NOTE',
  note: 'qa',
  content: 'qa',
  signerName: 'QA',
  dose: '1',
  frequency: 'c/24h',
  type: 'TREATMENT',
  petId: ids.pet,
  clientId: ids.client,
};
const routes = [
  ['GET', `/attachments/${ids.attachment}/file`],
  ['GET', `/consents/${ids.consent}`],
  ['GET', `/grooming/${ids.grooming}`],
  ['GET', `/pets/${ids.pet}`],
  ['GET', `/pets/${ids.pet}/attachments`],
  ['GET', `/pets/${ids.pet}/consents`],
  ['GET', `/pets/${ids.pet}/grooming`],
  ['GET', `/pets/${ids.pet}/immunization-card`],
  ['GET', `/pets/${ids.pet}/immunizations`],
  ['GET', `/prescriptions/${ids.rx}`],
  ['GET', `/cash/receipts/${ids.receipt}`],
  ['GET', `/cash/sessions/${ids.session}`],
  ['GET', `/clients/${ids.client}`],
  ['GET', `/clients/${ids.client}/export`],
  ['GET', `/clients/${ids.client}/portal`],
  ['GET', `/estimates/${ids.estimate}`],
  ['GET', `/hospitalizations/${ids.hosp}`],
  ['GET', `/inventory/products/${ids.product}`],
  ['GET', `/inventory/products/${ids.product}/movements`],
  ['GET', `/visits/${ids.visit}`],
  ['GET', `/visits/clients/${ids.client}/account`],
  ['GET', `/visits?petId=${ids.pet}`],
  ['GET', `/visits?clientId=${ids.client}`],
  ['GET', `/appointments?petId=${ids.pet}`],
  ['GET', `/estimates?petId=${ids.pet}`],
  ['GET', `/cash/pending?clientId=${ids.client}`],
  ['DELETE', `/clients/${ids.client}/authorized/${ids.person}`],
  ['DELETE', `/clients/${ids.client}/portal`],
  ['DELETE', `/clinical-templates/${ids.template}`],
  ['PATCH', `/grooming/${ids.grooming}/groomer`],
  ['PATCH', `/grooming/${ids.grooming}/status`],
  ['PATCH', `/pets/${ids.pet}`],
  ['PATCH', `/appointments/${ids.appt}`],
  ['PATCH', `/care-services/${ids.service}`],
  ['PATCH', `/clients/${ids.client}`],
  ['PATCH', `/clinical-templates/${ids.template}`],
  ['PATCH', `/hospitalizations/${ids.hosp}`],
  ['PATCH', `/inventory/presentations/${ids.presentation}`],
  ['PATCH', `/inventory/products/${ids.product}`],
  ['PATCH', `/queue/${ids.queue}`],
  ['PATCH', `/users/${ids.user}`],
  ['PATCH', `/visits/${ids.visit}`],
  ['POST', `/attachments/${ids.attachment}/void`],
  ['POST', `/clients/${ids.client}/pets`],
  ['POST', `/consents/${ids.consent}/void`],
  ['POST', `/grooming/${ids.grooming}/cancel`],
  ['POST', `/grooming/${ids.grooming}/deliver`],
  ['POST', `/grooming/${ids.grooming}/notify`],
  ['POST', `/immunizations/${ids.imm}/void`],
  ['POST', `/prescriptions/${ids.rx}/void`],
  ['POST', `/visits/${ids.visit}/prescriptions`],
  ['POST', `/appointments/${ids.appt}/arrive`],
  ['POST', `/appointments/${ids.appt}/cancel`],
  ['POST', `/appointments/${ids.appt}/confirm`],
  ['POST', `/appointments/${ids.appt}/no-show`],
  ['POST', `/billing/documents/${ids.doc}/retry`],
  ['POST', `/cash/expenses/${ids.expense}/void`],
  ['POST', `/cash/receipts/${ids.receipt}/void`],
  ['POST', `/cash/sessions/${ids.session}/close`],
  ['POST', `/clients/${ids.client}/anonymize`],
  ['POST', `/clients/${ids.client}/authorized`],
  ['POST', `/clients/${ids.client}/portal`],
  ['POST', `/clinical-templates/${ids.template}/used`],
  ['POST', `/estimates/${ids.estimate}/accept`],
  ['POST', `/estimates/${ids.estimate}/convert`],
  ['POST', `/estimates/${ids.estimate}/reject`],
  ['POST', `/hospitalizations/${ids.hosp}/discharge`],
  ['POST', `/hospitalizations/${ids.hosp}/entries`],
  ['POST', `/hospitalizations/${ids.hosp}/orders`],
  ['POST', `/hospitalizations/${ids.hosp}/orders/${order}/stop`],
  ['POST', `/inventory/products/${ids.product}/counts`],
  ['POST', `/inventory/products/${ids.product}/outflows`],
  ['POST', `/inventory/products/${ids.product}/presentations`],
  ['POST', `/inventory/products/${ids.product}/purchases`],
  ['POST', `/users/${ids.user}/reset-password`],
  ['POST', `/visits/${ids.visit}/addenda`],
  ['POST', `/visits/${ids.visit}/cancel`],
  ['POST', `/visits/${ids.visit}/close`],
  ['POST', `/visits/charges/${ids.charge}/void`],
  ['POST', `/visits/inventory/shortages/${ids.shortage}/resolve`],
  // Referencias de otra clínica dentro del cuerpo
  ['POST', '/queue', { petId: ids.pet, reason: 'qa' }],
  [
    'POST',
    '/appointments',
    {
      petId: ids.pet,
      startsAt: new Date(Date.now() + 864e5).toISOString(),
      durationMin: 30,
    },
  ],
  ['POST', '/visits', { petId: ids.pet, type: 'CONSULTATION' }],
  [
    'POST',
    '/estimates',
    { petId: ids.pet, items: [{ careServiceId: ids.service, quantity: 1 }] },
  ],
  [
    'POST',
    '/hospitalizations',
    { petId: ids.pet, reason: 'qa', cageLabel: 'Q1' },
  ],
  [
    'POST',
    '/consents',
    { petId: ids.pet, kind: 'SURGERY', signerName: 'QA', procedure: 'qa' },
  ],
];
// Cuerpos de una sola clave: el primero que pasa la validación llega a la lógica (y debe dar 404)
const candidates = [
  {},
  ...Object.entries(body).map(([k, v]) => ({ [k]: v })),
  { reason: 'QA aislamiento entre clínicas', signature: undefined },
  { kind: 'OBSERVATION', text: 'qa' },
  { productId: ids.product, presentationId: ids.presentation, quantity: 1 },
  {
    presentationId: ids.presentation,
    quantity: 1,
    lotNumber: 'Q',
    expiresAt: '2030-01-01',
  },
  { counts: [{ batchId: 1, quantity: 1 }], reason: 'qa' },
  { name: 'QA', factor: 1, price: 1 },
  { name: 'QA', relationship: 'Otro', docNumber: '12345678' },
  { name: 'QA', species: 'DOG' },
  { items: [{ drug: 'qa', dose: '1', frequency: 'c/24h', duration: '1 día' }] },
  { notes: 'qa', weightKg: 1 },
  { summary: 'qa' },
  { instructions: 'qa' },
  { countedCash: 0 },
  { closingCash: 0 },
  { status: 'DONE' },
  { status: 'READY' },
  { groomerId: ids.user },
  { label: 'QA' },
  { fullName: 'QA' },
  { recordedAt: new Date().toISOString(), temperatureC: 38 },
  {
    careServiceId: ids.service,
    frequencyHours: 8,
    startsAt: new Date().toISOString(),
  },
];
const results = [];
for (const [method, path, custom] of routes) {
  let res,
    text = '',
    tried = 0;
  const list = method === 'GET' ? [undefined] : custom ? [custom] : candidates;
  for (const b of list) {
    tried++;
    res = await fetch(API + path, {
      method,
      headers: { cookie, 'content-type': 'application/json' },
      body: b === undefined ? undefined : JSON.stringify(b),
    });
    text = '';
    try {
      text = (await res.text()).slice(0, 110);
    } catch {}
    if (res.status !== 400 || !text.includes('Datos inválidos')) break;
  }
  results.push({ method, path, status: res.status, text });
}
const leaks = results.filter((r) => r.status < 300);
const by = {};
for (const r of results) by[r.status] = (by[r.status] ?? 0) + 1;
console.log('códigos:', JSON.stringify(by), 'rutas:', results.length);
for (const r of results.filter(
  (r) => r.status === 400 || r.status >= 500 || r.status < 300,
))
  console.log(r.status, r.method, r.path, '→', r.text);
console.log(
  leaks.length
    ? `FUGAS: ${leaks.length}`
    : 'Sin fugas: ninguna ruta devolvió datos ni aceptó cambios de otra clínica',
);
await db.end();
