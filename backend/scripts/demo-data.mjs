/**
 * Datos de demostración: arma una clínica con historia, para mostrar el sistema "con vida".
 *
 * Todo se crea por la API, así se cumplen las mismas reglas que en el uso real (stock FEFO,
 * IGV, correlativos, comprobantes, bitácora). Después, lo de cada día pasado se lleva a su
 * fecha con SQL (atenciones, cobros, cierres de caja, kardex, grooming, vacunas…), para que el
 * dashboard, la caja, los reportes y la historia clínica tengan semanas de movimiento.
 *
 * Variables:
 *   DEMO_PASSWORD      clave del equipo de demostración (10+ caracteres, letras y números)
 *   DATABASE_URL       la base de datos (dentro de Docker ya está definida)
 *   API_URL            por defecto http://127.0.0.1:3000/api
 *   DEMO_DAYS          días de historia (por defecto 35)
 *   DEMO_RESET=1       si ya existe la clínica de demostración, la archiva y crea otra
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *                      en un servidor nuevo: carga la demo en la clínica del seed (si está vacía)
 *
 * Local:    docker compose exec -e DEMO_PASSWORD=Demo2026clave api node scripts/demo-data.mjs
 * Servidor: uywa exec api node scripts/demo-data.mjs
 *
 * Sin la clínica del seed vacía, crea una clínica aparte ("Veterinaria Huellitas") con su propio
 * administrador (admin@huellitas.pe): nunca se mezcla con datos reales.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const API = (process.env.API_URL ?? 'http://127.0.0.1:3000/api').replace(/\/$/, '');
const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL ?? '';
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? '';
const DAYS = Math.min(90, Math.max(7, Number(process.env.DEMO_DAYS ?? 35) || 35));
const DOMAIN = 'huellitas.pe';
const TZ = 'America/Lima';

if (!/^(?=.*[A-Za-z])(?=.*\d).{10,100}$/.test(DEMO_PASSWORD))
  fail('Define DEMO_PASSWORD: al menos 10 caracteres, con letras y números');
if (!process.env.DATABASE_URL) fail('Define DATABASE_URL');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}
const step = (text) => console.log(`→ ${text}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Azar con semilla: la demo sale igual cada vez ──
let seed = 20261029;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = (list) => list[Math.floor(rand() * list.length)];
const chance = (p) => rand() < p;
const between = (a, b) => a + Math.floor(rand() * (b - a + 1));
const round1 = (n) => Math.round(n * 10) / 10;

// ── API ──
const stats = { calls: 0, ms: 0 };
async function call(cookie, method, path, body, attempt = 0) {
  stats.calls++;
  const t0 = Date.now();
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body instanceof FormData ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
  });
  // La API limita las peticiones por minuto: se espera y se reintenta
  if (res.status === 429 && attempt < 12) {
    await sleep(6000);
    return call(cookie, method, path, body, attempt + 1);
  }
  const text = await res.text();
  stats.ms += Date.now() - t0;
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const detail = data?.errors?.join(', ') ?? data?.message ?? text;
    throw new Error(`${method} ${path} → ${res.status}: ${detail}`);
  }
  return { data, res };
}

async function login(email, password) {
  const { res, data } = await call(null, 'POST', '/auth/login', { email, password });
  return { cookie: sessionCookie(res), user: data.user };
}

function sessionCookie(res) {
  const raw = res.headers.get('set-cookie') ?? '';
  const match = /uywa_session=[^;]+/.exec(raw);
  if (!match) throw new Error('La API no devolvió la cookie de sesión');
  return match[0];
}

// ── Fechas (hora de Lima) ──
const limaDay = (at = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
const today = limaDay();
const day = (offset) => {
  const d = new Date(`${today}T12:00:00-05:00`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const yearsAgo = (years) => day(-Math.round(years * 365));
const weekday = (iso) => new Date(`${iso}T12:00:00-05:00`).getUTCDay(); // 0 = domingo
/** AAAA-MM-DD + HH:MM de Lima → ISO */
const limaIso = (d, time) => new Date(`${d}T${time}:00-05:00`).toISOString();
/** Próximo cuarto de hora desde ahora (+ minutos) */
function soon(minutes) {
  const t = new Date(Date.now() + minutes * 60_000);
  t.setUTCMinutes(Math.ceil(t.getUTCMinutes() / 15) * 15, 0, 0);
  return t.toISOString();
}

// ── PNG mínimo (firma y una "radiografía") sin dependencias ──
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function png(width, height, pixel) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      raw.set([r, g, b, a], y * (width * 4 + 1) + 1 + x * 4);
    }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
/** Firma: un trazo ondulado */
function signaturePng() {
  return png(360, 120, (x, y) => {
    const curve = 60 + Math.sin(x / 14) * 22 * Math.sin(x / 90) + (x > 250 ? (x - 250) * 0.15 : 0);
    const ink = x > 30 && x < 330 && Math.abs(y - curve) < 1.8;
    return ink ? [15, 23, 42, 255] : [0, 0, 0, 0];
  });
}
/** Imagen gris con una silueta clara, como una radiografía */
function xrayPng() {
  return png(320, 240, (x, y) => {
    const bone = Math.abs(y - 120 - Math.sin(x / 40) * 10) < 9 || Math.abs(x - 160) < 6;
    const v = bone ? 220 : 40 + ((x * 7 + y * 3) % 25);
    return [v, v, v, 255];
  });
}

// ── Datos base ──
const FIRST_F = ['María', 'Rosa', 'Carmen', 'Ana', 'Lucía', 'Sofía', 'Valeria', 'Elena', 'Patricia', 'Gabriela', 'Daniela', 'Fiorella', 'Milagros', 'Katherine', 'Jimena', 'Andrea', 'Claudia', 'Rocío', 'Yesenia', 'Liliana'];
const FIRST_M = ['José', 'Luis', 'Carlos', 'Jorge', 'Miguel', 'Pedro', 'Diego', 'Juan', 'Ricardo', 'Renzo', 'Alonso', 'Víctor', 'Raúl', 'Óscar', 'Fernando', 'Christian', 'Walter', 'César', 'Martín', 'Hugo'];
const LAST = ['Quispe', 'Mamani', 'Huamán', 'Flores', 'Rojas', 'Torres', 'Vargas', 'Ramos', 'Castillo', 'Chávez', 'Gutiérrez', 'Salazar', 'Paredes', 'Medina', 'Díaz', 'Mendoza', 'Ruiz', 'Vílchez', 'Ccori', 'Cruz', 'Soto', 'León', 'Pérez', 'Gómez', 'Cáceres', 'Ríos', 'Espinoza', 'Aguilar', 'Palomino', 'Ticona'];
const STREETS = ['Av. Lima', 'Jr. Arequipa', 'Av. Las Flores', 'Calle Los Olivos', 'Av. Carapongo', 'Jr. Huancayo', 'Av. Nicolás Ayllón', 'Calle San Martín'];
const DISTRICTS = ['Chosica', 'Lurigancho', 'Chaclacayo', 'Ate', 'Santa Anita'];
const DOG_NAMES = ['Toby', 'Max', 'Rocky', 'Bruno', 'Firulais', 'Canela', 'Lola', 'Coco', 'Bobby', 'Zeus', 'Thor', 'Princesa', 'Chispa', 'Manchas', 'Oso', 'Duque', 'Kira', 'Simba', 'Rex', 'Negrita', 'Pancho', 'Chocolate', 'Bella', 'Mía', 'Tito', 'Peluchín', 'Hachi', 'Lucky', 'Sasha', 'Benji'];
const CAT_NAMES = ['Mishi', 'Michi', 'Garfield', 'Tom', 'Nieve', 'Salem', 'Mimi', 'Félix', 'Kitty', 'Sombra', 'Tigre', 'Misifú', 'Lucas', 'Oreo', 'Cleo', 'Gatubela', 'Pelusa', 'Nala'];
const DOG_BREEDS = [['Mestizo', 8, 25], ['Shih tzu', 5, 8], ['Poodle', 4, 8], ['Schnauzer', 6, 10], ['Labrador', 25, 36], ['Golden retriever', 25, 34], ['Pitbull', 20, 30], ['Bulldog francés', 9, 13], ['Pastor alemán', 28, 40], ['Chihuahua', 1.5, 3], ['Beagle', 9, 14], ['Yorkshire', 2, 4], ['Cocker spaniel', 11, 15], ['Husky siberiano', 20, 27], ['Rottweiler', 38, 50]];
const CAT_BREEDS = [['Común europeo', 3.5, 5.5], ['Siamés', 3, 5], ['Persa', 3.5, 5.5], ['Angora', 3, 5]];

/** RUC con su dígito verificador (módulo 11 de SUNAT) */
function ruc(base10) {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const sum = base10.split('').reduce((acc, d, i) => acc + Number(d) * w[i], 0);
  return base10 + ((11 - (sum % 11)) % 10);
}
const CLINIC_RUC = ruc('2061234567');
const COMPANY_RUC = ruc('2060123456');

const usedPhones = new Set();
function phone() {
  let p;
  do p = `9${between(10_000_000, 99_999_999)}`;
  while (usedPhones.has(p));
  usedPhones.add(p);
  return p;
}
let dniBase = 40_000_000 + (Date.now() % 1_000_000) * 7;
function person() {
  const female = chance(0.55);
  const name = `${pick(female ? FIRST_F : FIRST_M)} ${pick(LAST)} ${pick(LAST)}`;
  return { name, female };
}
function newPet(usedNames) {
  const roll = rand();
  const species = roll < 0.62 ? 'DOG' : roll < 0.92 ? 'CAT' : pick(['RABBIT', 'GUINEA_PIG', 'BIRD']);
  let name;
  const pool = species === 'CAT' ? CAT_NAMES : DOG_NAMES;
  do name = pick(pool);
  while (usedNames.has(name) && usedNames.size < pool.length);
  usedNames.add(name);
  if (species === 'DOG') {
    const [breed, min, max] = pick(DOG_BREEDS);
    return { name, species, breed, sex: chance(0.5) ? 'MALE' : 'FEMALE', neutered: chance(0.4), birthDate: yearsAgo(round1(0.5 + rand() * 11)), weightKg: round1(min + rand() * (max - min)) };
  }
  if (species === 'CAT') {
    const [breed, min, max] = pick(CAT_BREEDS);
    return { name, species, breed, sex: chance(0.5) ? 'MALE' : 'FEMALE', neutered: chance(0.6), birthDate: yearsAgo(round1(0.5 + rand() * 12)), weightKg: round1(min + rand() * (max - min)) };
  }
  const exotic = { RABBIT: ['Cabeza de león', 1.5], GUINEA_PIG: ['Peruano', 1], BIRD: ['Periquito', 0.05] }[species];
  return { name: pick(['Copito', 'Pelusa', 'Kiwi', 'Algodón', 'Pipo', 'Coco']), species, breed: exotic[0], sex: chance(0.5) ? 'MALE' : 'FEMALE', birthDate: yearsAgo(round1(0.5 + rand() * 3)), weightKg: exotic[1] };
}

// Consultas que se repiten en una clínica real (S, O, A, P)
const CASES = [
  { reason: 'Vacuna anual', vaccine: true, anamnesis: 'Viene por su vacuna anual. Come bien, sin vómitos ni diarrea.', exam: 'Buen estado general. Sin hallazgos.', dx: 'Paciente sano', definitive: true, plan: 'Se aplica la vacuna. Próxima dosis en un año.' },
  { reason: 'Control general', anamnesis: 'Control de rutina, el dueño no reporta molestias.', exam: 'Mucosas rosadas, auscultación normal.', dx: 'Paciente sano', definitive: true, plan: 'Mantener alimentación y desparasitación al día.' },
  { reason: 'Picazón y caída de pelo', anamnesis: 'Se rasca mucho hace una semana.', exam: 'Eritema y pápulas en zona lumbar, presencia de pulgas.', dx: 'Dermatitis alérgica por pulgas', definitive: false, plan: 'Antipulgas hoy y a todos los animales de la casa. Control en 15 días.', rx: ['Prednisolona 5 mg', '1/2 tableta', 'Cada 24 horas', '5 días'], antipulgas: true },
  { reason: 'Se sacude las orejas', anamnesis: 'Mal olor en el oído derecho desde hace 4 días.', exam: 'Otitis externa derecha, secreción marrón.', dx: 'Otitis externa', definitive: false, plan: 'Limpieza ótica y gotas por 7 días.', rx: ['Otomax gotas', '5 gotas', 'Cada 12 horas', '7 días'] },
  { reason: 'Vómitos y diarrea', anamnesis: 'Vomitó 3 veces desde anoche, comió basura.', exam: 'Dolor leve a la palpación abdominal, deshidratación 5 %.', dx: 'Gastroenteritis aguda', definitive: false, plan: 'Fluidos subcutáneos, dieta blanda 3 días.', rx: ['Metoclopramida 10 mg', '1/4 tableta', 'Cada 8 horas', '3 días'], fluids: true },
  { reason: 'Cojea de una pata', anamnesis: 'Cojea desde ayer después de jugar en el parque.', exam: 'Dolor a la flexión de la rodilla, sin inflamación.', dx: 'Esguince', definitive: false, plan: 'Reposo 7 días. Antiinflamatorio.', meloxicam: true },
  { reason: 'Desparasitación', deworm: true, anamnesis: 'Toca desparasitación interna.', exam: 'Buen estado general.', dx: 'Paciente sano', definitive: true, plan: 'Se desparasita. Repetir en 3 meses.' },
  { reason: 'Chequeo geriátrico', anamnesis: 'Perro mayor, toma más agua de lo normal.', exam: 'Sarro dental grado 2, soplo leve.', dx: 'Enfermedad periodontal', definitive: false, plan: 'Análisis de sangre y profilaxis dental programada.', lab: true },
];

// ── Base de datos: crear la clínica aparte y llevar cada día a su fecha ──
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
let clinicId = 0;

/** Tablas de la clínica cuyos registros nuevos de cada día se mueven a su fecha */
let SHIFT_TABLES = [];
/** Columnas que no se tocan (no dependen del día en que se registran) */
const KEEP_COLUMNS = new Set(['birth_date', 'deceased_at', 'expires_at', 'updated_at', 'logo_updated_at', 'locked_until', 'last_login_at']);
/** Planes a futuro: se mueven solo de día, sin estirar las horas */
const FUTURE_COLUMNS = new Set(['starts_at', 'promised_at', 'next_attempt_at']);

async function loadShiftTables() {
  const { rows } = await db.query(`
    SELECT c.table_name, array_agg(c.column_name::text) FILTER (WHERE c.data_type IN ('timestamp with time zone','date')) AS cols,
           array_agg(c.column_name::text) FILTER (WHERE c.data_type = 'date') AS dates
    FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='clinic_id')
      AND c.table_name IN (SELECT table_name FROM information_schema.columns WHERE table_schema='public' AND column_name='id')
      AND c.table_name NOT IN ('clinics','users','clinic_sequences','consents','care_services','billing_settings')
    GROUP BY c.table_name`);
  SHIFT_TABLES = rows
    .map((r) => ({
      table: r.table_name,
      cols: (r.cols ?? []).filter((c) => !KEEP_COLUMNS.has(c)),
      dates: new Set(r.dates ?? []),
    }))
    .filter((t) => t.cols.length);
}

async function snapshot() {
  const snap = {};
  for (const t of SHIFT_TABLES) {
    const { rows } = await db.query(`SELECT coalesce(max(id), 0) AS id FROM "${t.table}" WHERE clinic_id = $1`, [clinicId]);
    snap[t.table] = rows[0].id;
  }
  return { snap, at: new Date() };
}

/**
 * Lleva lo creado desde `start` al día `target`: las horas del bloque se reparten entre
 * `from` y `to` (hora de Lima) y las fechas se corren los días que correspondan.
 */
async function shiftTo(start, target, from = '09:05', to = '19:10') {
  const end = new Date();
  const t0 = Date.now();
  const offsetDays = Math.round((new Date(`${today}T12:00:00Z`) - new Date(`${target}T12:00:00Z`)) / 86_400_000);
  const base = new Date(limaIso(target, from));
  const span = new Date(limaIso(target, to)) - base;
  const factor = span / Math.max(1, end - start.at);
  for (const t of SHIFT_TABLES) {
    const sets = t.cols.map((c) =>
      t.dates.has(c)
        ? `"${c}" = "${c}" - ${offsetDays}`
        : FUTURE_COLUMNS.has(c)
          ? `"${c}" = "${c}" - interval '${offsetDays} days'`
          : `"${c}" = $2::timestamptz + ("${c}" - $3::timestamptz) * $4::float8`,
    );
    await db.query(
      `UPDATE "${t.table}" SET ${sets.join(', ')} WHERE clinic_id = $1 AND id > $5`,
      [clinicId, base.toISOString(), start.at.toISOString(), factor, start.snap[t.table]],
    );
  }
  // Las citas que llegaron quedan a la hora en que llegaron (redondeada al cuarto de hora)
  await db.query(
    `UPDATE appointments a SET starts_at = to_timestamp(floor(extract(epoch FROM q.arrived_at) / 900) * 900)
     FROM queue_entries q WHERE a.queue_entry_id = q.id AND a.clinic_id = $1 AND a.id > $2`,
    [clinicId, start.snap.appointments ?? 0],
  );
  await db.query(
    `UPDATE appointments SET starts_at = to_timestamp(floor(extract(epoch FROM created_at) / 900) * 900)
     WHERE status = 'NO_SHOW' AND clinic_id = $1 AND id > $2`,
    [clinicId, start.snap.appointments ?? 0],
  );
  if (process.env.DEMO_DEBUG) console.log('shift ms', Date.now() - t0, 'snapshot→end', end - start.at);
}

async function prepareClinic() {
  // Servidor nuevo: la clínica del seed, si está vacía
  if (SEED_EMAIL && SEED_PASSWORD) {
    const admin = await login(SEED_EMAIL, SEED_PASSWORD);
    const existing = await call(admin.cookie, 'GET', '/clients?status=all');
    if (existing.data.total === 0) {
      clinicId = admin.user.clinic.id;
      return { cookie: admin.cookie, email: SEED_EMAIL, password: '(su clave de siempre)' };
    }
    step('La clínica del seed ya tiene clientes: se crea una clínica de demostración aparte');
  }
  const email = `admin@${DOMAIN}`;
  const { rows } = await db.query('SELECT id, clinic_id FROM users WHERE email = $1', [email]);
  if (rows.length) {
    // Una demo que quedó a medias (sin clientes) se rehace sola
    const { rows: done } = await db.query('SELECT count(*)::int AS n FROM clients WHERE clinic_id = $1', [rows[0].clinic_id]);
    if (done[0].n > 0 && process.env.DEMO_RESET !== '1')
      fail(`La demostración ya existe (${email}). Para crearla de nuevo, agrega -e DEMO_RESET=1.`);
    const old = rows[0].clinic_id;
    step('Archivando la demostración anterior');
    await db.query(
      `UPDATE users SET email = 'archivo-' || id || '-' || email, active = false WHERE clinic_id = $1`,
      [old],
    );
    await db.query(`UPDATE clinics SET active = false, name = name || ' (archivada)' WHERE id = $1`, [old]);
  }
  const clinic = await db.query(
    `INSERT INTO clinics (name, ruc, address, phone, email, updated_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    ['Veterinaria Huellitas', CLINIC_RUC, 'Av. Lima 245, Chosica', '987 000 111', `hola@${DOMAIN}`],
  );
  clinicId = clinic.rows[0].id;
  await db.query(
    `INSERT INTO users (clinic_id, full_name, email, password_hash, role, updated_at) VALUES ($1, $2, $3, $4, 'ADMIN', now())`,
    [clinicId, 'Andrea Salazar Ríos', email, await bcrypt.hash(DEMO_PASSWORD, 10)],
  );
  const admin = await login(email, DEMO_PASSWORD);
  return { cookie: admin.cookie, email, password: DEMO_PASSWORD };
}

/** Espera a que la API responda (recién reiniciada tarda en compilar) */
async function waitForApi() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch {
      // todavía arrancando
    }
    if (i === 0) step('Esperando a que la API termine de arrancar…');
    await sleep(3000);
  }
  fail(
    `La API no responde en ${API}. Revisa qué pasó con:  docker compose logs api --tail 40`,
  );
}

async function main() {
  step(`Conectando con ${API}`);
  await waitForApi();
  await db.connect();
  await loadShiftTables();
  const owner = await prepareClinic();
  const admin = owner.cookie;
  const adminEmailDomain = owner.email.split('@')[1];

  // ── Clínica ──
  step('Clínica, horario y comprobantes');
  const profile = (await call(admin, 'GET', '/clinic')).data;
  await call(admin, 'PATCH', '/clinic', {
    name: profile.name,
    ruc: profile.ruc ?? CLINIC_RUC,
    address: profile.address ?? 'Av. Lima 245, Chosica',
    phone: profile.phone ?? '987 000 111',
    email: profile.email,
  });
  await call(admin, 'PUT', '/clinic/hours', {
    days: [1, 2, 3, 4, 5, 6, 7].map((d) =>
      d <= 5 ? { day: d, open: '08:30', close: '20:00' } : d === 6 ? { day: d, open: '09:00', close: '14:00' } : { day: d, open: null, close: null },
    ),
  });
  // Boletas y facturas en simulación: se numeran e imprimen, sin ir a SUNAT
  await call(admin, 'PUT', '/billing/settings', {
    enabled: true,
    provider: 'SIMULATED',
    production: false,
    legalName: `${profile.name} S.A.C.`,
    apiUrl: null,
    boletaSeries: 'B001',
    facturaSeries: 'F001',
    boletaCreditSeries: 'BC01',
    facturaCreditSeries: 'FC01',
  });

  // ── Equipo: cada persona entra con DEMO_PASSWORD ──
  step('Equipo de la clínica');
  const team = {};
  const prefix = adminEmailDomain === DOMAIN ? '' : 'demo.';
  for (const [key, member] of Object.entries({
    vet: { fullName: 'Dra. Lucía Ruiz Paredes', role: 'VET', licenseNumber: '08451' },
    vet2: { fullName: 'Dr. Carlos Mendoza Ríos', role: 'VET', licenseNumber: '11287' },
    reception: { fullName: 'Carmen Huamán Soto', role: 'RECEPTION' },
    cashier: { fullName: 'Jorge Quispe Rojas', role: 'CASHIER' },
    groomer: { fullName: 'Rosa Flores Medina', role: 'GROOMER', commissionPercent: 30 },
    groomer2: { fullName: 'Kevin Torres Ccori', role: 'GROOMER', commissionPercent: 25 },
  })) {
    const email = `${prefix}${key}@${adminEmailDomain}`;
    const { data } = await call(admin, 'POST', '/users', { ...member, email });
    const first = await login(email, data.temporaryPassword);
    const changed = await call(first.cookie, 'PATCH', '/auth/password', {
      currentPassword: data.temporaryPassword,
      newPassword: DEMO_PASSWORD,
    });
    team[key] = { id: data.user.id, email, cookie: sessionCookie(changed.res), name: member.fullName };
  }
  const { vet, vet2, reception, cashier, groomer, groomer2 } = team;
  const vets = [vet, vet2];
  const groomers = [groomer, groomer2];

  // ── Inventario: compras de hace dos meses ──
  step('Inventario y compras');
  const products = {};
  const buy = async (key, product, purchase) => {
    let id = products[key]?.id;
    if (!id) {
      const { data } = await call(vet.cookie, 'POST', '/inventory/products', product);
      id = data.id;
      products[key] = { id, sale: data.presentations.at(-1).id, presentations: data.presentations };
    }
    const presentation = products[key].presentations.find((p) => p.factor === purchase.factor) ?? products[key].presentations[0];
    await call(vet.cookie, 'POST', `/inventory/products/${id}/purchases`, {
      presentationId: presentation.id,
      quantity: purchase.quantity,
      lotNumber: purchase.lot,
      expiresAt: purchase.expiresAt,
      costPerPresentation: purchase.cost,
      supplier: purchase.supplier ?? 'Droguería Andina S.A.C.',
      documentNumber: purchase.document,
    });
  };
  const CATALOG = {
    sextuple: { name: 'Vacuna séxtuple canina', category: 'VACCINE', baseUnit: 'UNIT', minStock: 8, presentations: [{ name: 'Dosis', factor: 1, price: 60 }] },
    triple: { name: 'Vacuna triple felina', category: 'VACCINE', baseUnit: 'UNIT', minStock: 5, presentations: [{ name: 'Dosis', factor: 1, price: 55 }] },
    rabia: { name: 'Vacuna antirrábica', category: 'VACCINE', baseUnit: 'UNIT', minStock: 8, presentations: [{ name: 'Dosis', factor: 1, price: 35 }] },
    antipulgas: { name: 'Antipulgas masticable 10-20 kg', category: 'ANTIPARASITIC', baseUnit: 'TABLET', minStock: 6, presentations: [{ name: 'Tableta', factor: 1, price: 85 }] },
    pipeta: { name: 'Pipeta antipulgas gato', category: 'ANTIPARASITIC', baseUnit: 'UNIT', minStock: 6, presentations: [{ name: 'Pipeta', factor: 1, price: 38 }] },
    desparasitante: { name: 'Desparasitante interno perro', category: 'ANTIPARASITIC', baseUnit: 'TABLET', minStock: 20, presentations: [{ name: 'Caja x 10', factor: 10, price: 120 }, { name: 'Tableta', factor: 1, price: 15 }] },
    meloxicam: { name: 'Meloxicam 1 mg', category: 'MEDICINE', baseUnit: 'TABLET', minStock: 30, requiresPrescription: true, presentations: [{ name: 'Caja x 100', factor: 100, price: 150 }, { name: 'Blíster x 10', factor: 10, price: 18 }, { name: 'Tableta', factor: 1, price: 2 }] },
    amoxicilina: { name: 'Amoxicilina 250 mg', category: 'MEDICINE', baseUnit: 'TABLET', minStock: 20, requiresPrescription: true, presentations: [{ name: 'Caja x 100', factor: 100, price: 160 }, { name: 'Blíster x 10', factor: 10, price: 20 }] },
    suero: { name: 'Cloruro de sodio 0.9 % 500 ml', category: 'SUPPLY', baseUnit: 'ML', minStock: 1500, presentations: [{ name: 'Frasco 500 ml', factor: 500, price: 18 }] },
    jeringa: { name: 'Jeringa 3 ml', category: 'SUPPLY', baseUnit: 'UNIT', minStock: 40, presentations: [{ name: 'Caja x 100', factor: 100, price: 45 }, { name: 'Unidad', factor: 1, price: 1 }] },
    champu: { name: 'Champú clorhexidina', category: 'HYGIENE', baseUnit: 'ML', minStock: 500, presentations: [{ name: 'Frasco 500 ml', factor: 500, price: 38 }] },
    champuNormal: { name: 'Champú neutro grooming', category: 'HYGIENE', baseUnit: 'ML', minStock: 1000, presentations: [{ name: 'Galón 3.8 L', factor: 3800, price: 95 }] },
    alimento: { name: 'Alimento balanceado adulto 3 kg', category: 'FOOD', baseUnit: 'UNIT', minStock: 4, presentations: [{ name: 'Bolsa 3 kg', factor: 1, price: 89 }] },
    alimentoGato: { name: 'Alimento gato adulto 1.5 kg', category: 'FOOD', baseUnit: 'UNIT', minStock: 4, presentations: [{ name: 'Bolsa 1.5 kg', factor: 1, price: 52 }] },
    snack: { name: 'Snack dental perro', category: 'FOOD', baseUnit: 'UNIT', minStock: 10, presentations: [{ name: 'Unidad', factor: 1, price: 6 }] },
    collar: { name: 'Collar isabelino talla M', category: 'ACCESSORY', baseUnit: 'UNIT', minStock: 6, presentations: [{ name: 'Unidad', factor: 1, price: 25 }] },
  };
  const purchases = async (offset, factor = 1) => {
    const n = (q) => Math.max(1, Math.round(q * factor));
    await buy('sextuple', CATALOG.sextuple, { factor: 1, quantity: n(40), lot: `VS-${2600 + offset * -1}`, expiresAt: day(240), cost: 28, document: `F001-${1200 - offset}` });
    await buy('triple', CATALOG.triple, { factor: 1, quantity: n(20), lot: `TF-${900 - offset}`, expiresAt: day(180), cost: 26, document: `F001-${1200 - offset}` });
    await buy('rabia', CATALOG.rabia, { factor: 1, quantity: n(30), lot: `AR-${300 - offset}`, expiresAt: day(300), cost: 12, document: `F001-${1200 - offset}` });
    await buy('antipulgas', CATALOG.antipulgas, { factor: 1, quantity: n(60), lot: `AP-${7700 - offset}`, expiresAt: day(420), cost: 55, document: `F001-${1201 - offset}`, supplier: 'Agrovet del Centro E.I.R.L.' });
    await buy('pipeta', CATALOG.pipeta, { factor: 1, quantity: n(40), lot: `PG-${500 - offset}`, expiresAt: day(380), cost: 22, document: `F001-${1201 - offset}`, supplier: 'Agrovet del Centro E.I.R.L.' });
    await buy('desparasitante', CATALOG.desparasitante, { factor: 10, quantity: n(8), lot: `DP-${110 - offset}`, expiresAt: day(500), cost: 70, document: `F001-${1201 - offset}` });
    await buy('amoxicilina', CATALOG.amoxicilina, { factor: 100, quantity: n(2), lot: `AX-${40 - offset}`, expiresAt: day(400), cost: 90, document: `F001-${1202 - offset}` });
    await buy('suero', CATALOG.suero, { factor: 500, quantity: n(16), lot: `SF-${70 - offset}`, expiresAt: day(600), cost: 7, document: `F001-${1202 - offset}` });
    await buy('jeringa', CATALOG.jeringa, { factor: 100, quantity: n(3), lot: `JR-${60 - offset}`, expiresAt: day(900), cost: 18, document: `F001-${1202 - offset}` });
    await buy('champu', CATALOG.champu, { factor: 500, quantity: n(6), lot: `CH-${118 - offset}`, expiresAt: day(330), cost: 21, document: `F001-${1203 - offset}` });
    await buy('champuNormal', CATALOG.champuNormal, { factor: 3800, quantity: n(3), lot: `CN-${20 - offset}`, expiresAt: day(500), cost: 55, document: `F001-${1203 - offset}` });
    await buy('alimento', CATALOG.alimento, { factor: 1, quantity: n(30), lot: `AB-${5530 - offset}`, expiresAt: day(240), cost: 58, document: `F001-${1204 - offset}`, supplier: 'Distribuidora PetFood S.A.C.' });
    await buy('alimentoGato', CATALOG.alimentoGato, { factor: 1, quantity: n(20), lot: `AG-${880 - offset}`, expiresAt: day(260), cost: 33, document: `F001-${1204 - offset}`, supplier: 'Distribuidora PetFood S.A.C.' });
    await buy('snack', CATALOG.snack, { factor: 1, quantity: n(150), lot: `SN-${45 - offset}`, expiresAt: day(200), cost: 2.5, document: `F001-${1204 - offset}`, supplier: 'Distribuidora PetFood S.A.C.' });
  };
  let block = await snapshot();
  await purchases(-DAYS - 2);
  // Meloxicam que vence pronto y collar con poco stock: se ven en las alertas
  await buy('meloxicam', CATALOG.meloxicam, { factor: 100, quantity: 2, lot: 'MX-2611', expiresAt: day(24), cost: 85, document: 'F001-1188' });
  await buy('collar', CATALOG.collar, { factor: 1, quantity: 4, lot: null, expiresAt: null, cost: 9, document: 'F001-1188', supplier: 'Accesorios Lima S.A.C.' });
  await shiftTo(block, day(-DAYS - 2), '10:00', '11:30');

  // ── Servicios ──
  step('Servicios y precios');
  const services = {};
  for (const [key, s] of Object.entries({
    consulta: { name: 'Consulta general', category: 'CONSULTATION', price: 50, durationMin: 30 },
    control: { name: 'Control (reconsulta)', category: 'CONSULTATION', price: 30, durationMin: 20 },
    emergencia: { name: 'Consulta de emergencia', category: 'CONSULTATION', price: 90, durationMin: 45 },
    sextuple: { name: 'Vacunación séxtuple canina', category: 'VACCINATION', price: 75, durationMin: 15, supplies: [{ productId: products.sextuple.id, quantity: 1 }, { productId: products.jeringa.id, quantity: 1 }] },
    triple: { name: 'Vacunación triple felina', category: 'VACCINATION', price: 70, durationMin: 15, supplies: [{ productId: products.triple.id, quantity: 1 }, { productId: products.jeringa.id, quantity: 1 }] },
    rabia: { name: 'Vacunación antirrábica', category: 'VACCINATION', price: 45, durationMin: 10, supplies: [{ productId: products.rabia.id, quantity: 1 }, { productId: products.jeringa.id, quantity: 1 }] },
    desparasitacion: { name: 'Desparasitación interna', category: 'DEWORMING', price: 25, durationMin: 10, supplies: [{ productId: products.desparasitante.id, quantity: 1 }] },
    fluidos: { name: 'Fluidoterapia subcutánea', category: 'OTHER', price: 40, durationMin: 20, supplies: [{ productId: products.suero.id, quantity: 250 }] },
    hemograma: { name: 'Hemograma completo', category: 'LAB', price: 65, durationMin: 15 },
    castracion: { name: 'Castración canina', category: 'SURGERY', price: 350, durationMin: 90 },
    profilaxis: { name: 'Profilaxis dental', category: 'SURGERY', price: 220, durationMin: 60 },
    bano: { name: 'Baño completo', category: 'GROOMING', price: 35, durationMin: 60, supplies: [{ productId: products.champuNormal.id, quantity: 60 }], sizePrices: [{ size: 'MEDIUM', price: 45 }, { size: 'LARGE', price: 60 }, { size: 'GIANT', price: 80 }] },
    banoMedicado: { name: 'Baño medicado', category: 'GROOMING', price: 45, durationMin: 60, supplies: [{ productId: products.champu.id, quantity: 40 }], sizePrices: [{ size: 'MEDIUM', price: 55 }, { size: 'LARGE', price: 70 }, { size: 'GIANT', price: 90 }] },
    corte: { name: 'Corte de pelo', category: 'GROOMING', price: 30, durationMin: 60, sizePrices: [{ size: 'MEDIUM', price: 40 }, { size: 'LARGE', price: 55 }, { size: 'GIANT', price: 70 }] },
    unas: { name: 'Corte de uñas', category: 'GROOMING', price: 10, durationMin: 15 },
    oidos: { name: 'Limpieza de oídos', category: 'GROOMING', price: 12, durationMin: 10 },
    movilidad: { name: 'Movilidad (recojo y entrega)', category: 'GROOMING', price: 15, durationMin: 30 },
  })) {
    services[key] = (await call(admin, 'POST', '/care-services', s)).data.id;
  }

  // ── Clientes ──
  const pets = []; // { id, name, species, weightKg, clientId, owner }
  const usedPetNames = new Set();
  const newClient = async (opts = {}) => {
    const p = opts.person ?? person();
    const pet = opts.pet ?? newPet(usedPetNames);
    const { data } = await call(reception.cookie, 'POST', '/clients', {
      docType: opts.ruc ? 'RUC' : 'DNI',
      docNumber: opts.ruc ?? String(dniBase++),
      name: p.name,
      phone: phone(),
      email: chance(0.4) ? `${p.name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${between(10, 99)}@gmail.com` : null,
      address: `${pick(STREETS)} ${between(100, 999)}`,
      district: pick(DISTRICTS),
      consent: true,
      marketingConsent: chance(0.35),
      pet,
    });
    const entry = { id: data.pets[0].id, name: pet.name, species: pet.species, weightKg: pet.weightKg, clientId: data.id, owner: p.name, visits: 0 };
    pets.push(entry);
    if (chance(0.15)) {
      const second = newPet(usedPetNames);
      const extra = await call(reception.cookie, 'POST', `/clients/${data.id}/pets`, second);
      pets.push({ id: extra.data.id, name: second.name, species: second.species, weightKg: second.weightKg, clientId: data.id, owner: p.name, visits: 0 });
    }
    if (chance(0.2))
      await call(reception.cookie, 'POST', `/clients/${data.id}/authorized`, { name: `${pick(FIRST_F.concat(FIRST_M))} ${p.name.split(' ')[1]}`, dni: String(dniBase++), phone: phone(), relation: pick(['Hijo(a)', 'Esposo(a)', 'Hermano(a)']) }).catch(() => undefined);
    return entry;
  };

  step('Clientes que ya venían');
  block = await snapshot();
  const company = await newClient({ person: { name: 'Albergue Patitas Felices S.A.C.' }, ruc: COMPANY_RUC, pet: { name: 'Manchas', species: 'DOG', breed: 'Mestizo', sex: 'MALE', birthDate: yearsAgo(3), weightKg: 16 } });
  for (let i = 0; i < 26; i++) await newClient();
  await shiftTo(block, day(-DAYS - 1));

  // ── Ayudas del día ──
  const opened = { sessionId: null };
  const pickPet = (filter = () => true) => {
    const list = pets.filter(filter);
    return list[Math.floor(rand() * list.length)];
  };
  const sizeOf = (p) => (!p.weightKg || p.weightKg <= 10 ? 'SMALL' : p.weightKg <= 25 ? 'MEDIUM' : p.weightKg <= 40 ? 'LARGE' : 'GIANT');
  const payMethod = () => {
    const r = rand();
    return r < 0.42 ? 'CASH' : r < 0.67 ? 'YAPE' : r < 0.77 ? 'PLIN' : r < 0.93 ? 'CARD' : 'TRANSFER';
  };
  const collectClient = async (clientId, { partial = false } = {}) => {
    const ruc = clientId === company.clientId;
    const account = (await call(cashier.cookie, 'GET', `/clients/${clientId}/account`)).data;
    let amount = account.pendingTotal;
    if (amount <= 0) return;
    if (partial) amount = Math.max(10, Math.round(amount / 2));
    const method = payMethod();
    const tendered = method === 'CASH' ? Math.ceil(amount / 10) * 10 + (chance(0.4) ? 10 : 0) : null;
    await call(cashier.cookie, 'POST', '/cash/receipts', {
      requestKey: randomUUID(),
      clientId,
      amount,
      payments: [
        {
          method,
          amount,
          tendered,
          operationCode: method === 'CASH' ? null : String(between(100000, 999999)),
        },
      ],
      document: ruc ? 'FACTURA' : chance(0.55) ? 'BOLETA' : 'NOTE',
    });
  };
  const openCash = async () => {
    const { data } = await call(cashier.cookie, 'POST', '/cash/sessions', { openingAmount: pick([100, 150, 200]) });
    opened.sessionId = data.id;
  };
  const closeCash = async () => {
    const current = (await call(cashier.cookie, 'GET', '/cash/sessions/current')).data;
    if (!current) return;
    const off = chance(0.12) ? -pick([0.5, 1, 2]) : 0;
    await call(cashier.cookie, 'POST', `/cash/sessions/${current.id}/close`, {
      countedCash: Math.round((current.expectedCash + off) * 100) / 100,
      note: off ? 'Faltó sencillo para un vuelto' : null,
    });
  };

  /** Una consulta completa: cola (o cita), SOAP, cargos, vacuna, receta y cierre */
  const consult = async (pet, { appointmentEntry, closeIt = true, urgent = false, forcedCase } = {}) => {
    const c = forcedCase ?? pick(CASES.filter((x) => !(x.vaccine || x.deworm) || ['DOG', 'CAT'].includes(pet.species)));
    const doctor = pick(vets);
    const entry = appointmentEntry ?? (await call(reception.cookie, 'POST', '/queue', { petId: pet.id, urgent, reason: c.reason })).data.id;
    const visit = (await call(doctor.cookie, 'POST', '/visits', { petId: pet.id, queueEntryId: entry })).data;
    const weight = pet.weightKg ? round1(pet.weightKg * (0.97 + rand() * 0.06)) : null;
    await call(doctor.cookie, 'PATCH', `/visits/${visit.id}`, {
      weightKg: weight,
      temperatureC: round1(38.2 + rand() * (c.fluids ? 1.6 : 0.8)),
      heartRate: pet.species === 'CAT' ? between(150, 190) : between(80, 120),
      respiratoryRate: between(18, 32),
      capillaryRefillS: 1.5,
      mucosa: 'Rosadas',
      hydration: c.fluids ? 'Deshidratación 5 %' : 'Normal',
      bodyCondition: between(4, 6),
      anamnesis: c.anamnesis,
      physicalExam: c.exam,
      diagnosis: c.dx,
      diagnosisDefinitive: c.definitive,
      notes: c.plan,
    });
    const items = [];
    if (c.vaccine) {
      items.push({ careServiceId: pet.species === 'CAT' ? services.triple : chance(0.5) ? services.sextuple : services.rabia, quantity: 1 });
    } else if (c.deworm) {
      items.push({ careServiceId: services.desparasitacion, quantity: 1 });
    } else {
      items.push({ careServiceId: pet.visits > 0 && chance(0.4) ? services.control : urgent ? services.emergencia : services.consulta, quantity: 1 });
    }
    if (c.fluids) items.push({ careServiceId: services.fluidos, quantity: 1 });
    if (c.lab) items.push({ careServiceId: services.hemograma, quantity: 1 });
    if (c.antipulgas) items.push({ productId: pet.species === 'CAT' ? products.pipeta.id : products.antipulgas.id, presentationId: pet.species === 'CAT' ? products.pipeta.sale : products.antipulgas.sale, quantity: 1 });
    if (chance(0.15)) items.push({ productId: products.snack.id, presentationId: products.snack.sale, quantity: between(1, 3) });
    // Si un producto se acabó, se cobra solo el servicio (como en la vida real)
    await call(doctor.cookie, 'POST', '/charges', { visitId: visit.id, items }).catch(() =>
      call(doctor.cookie, 'POST', '/charges', { visitId: visit.id, items: items.filter((i) => i.careServiceId) }),
    );
    if (c.vaccine)
      await call(doctor.cookie, 'POST', '/immunizations', {
        petId: pet.id,
        visitId: visit.id,
        kind: 'VACCINE',
        name: pet.species === 'CAT' ? 'Triple felina' : items[0].careServiceId === services.rabia ? 'Antirrábica' : 'Séxtuple',
        laboratory: pick(['Zoetis', 'MSD', 'Boehringer']),
        batchNumber: pick(['VS-2611', 'TF-0931', 'AR-301']),
        nextDueAt: day(365),
      });
    if (c.deworm)
      await call(doctor.cookie, 'POST', '/immunizations', { petId: pet.id, visitId: visit.id, kind: 'DEWORMING_INTERNAL', name: 'Desparasitante interno', nextDueAt: day(90) });
    if (c.antipulgas)
      await call(doctor.cookie, 'POST', '/immunizations', { petId: pet.id, visitId: visit.id, kind: 'DEWORMING_EXTERNAL', name: pet.species === 'CAT' ? 'Pipeta antipulgas' : 'Antipulgas masticable', nextDueAt: day(pet.species === 'CAT' ? 30 : 90) });
    if (c.rx)
      await call(doctor.cookie, 'POST', `/visits/${visit.id}/prescriptions`, {
        notes: c.plan,
        items: [{ drug: c.rx[0], dose: c.rx[1], route: 'Oral', frequency: c.rx[2], duration: c.rx[3], instructions: 'Dar con comida' }],
      });
    if (c.meloxicam)
      await call(doctor.cookie, 'POST', `/visits/${visit.id}/prescriptions`, {
        notes: 'Reposo y control en 7 días.',
        items: [{ productId: products.meloxicam.id, presentationId: products.meloxicam.presentations.find((p) => p.factor === 1).id, drug: 'Meloxicam 1 mg', dose: '1 tableta', route: 'Oral', frequency: 'Cada 24 horas', duration: '5 días', dispenseQuantity: 5 }],
      });
    pet.visits++;
    if (weight) pet.weightKg = weight;
    if (closeIt) await call(doctor.cookie, 'POST', `/visits/${visit.id}/close`);
    return visit.id;
  };

  /** Un servicio de grooming del ingreso a la entrega (o hasta `until`) */
  const groom = async (pet, { until = 'DELIVERED', queueEntryId } = {}) => {
    const size = sizeOf(pet);
    const chosen = pick([[services.bano], [services.bano, services.unas], [services.bano, services.corte], [services.bano, services.corte, services.unas, services.oidos], [services.banoMedicado], [services.unas]]);
    const transport = chance(0.15) ? 'ROUND_TRIP' : 'NONE';
    if (transport !== 'NONE') chosen.push(services.movilidad);
    const g = pick(groomers);
    const { data } = await call(reception.cookie, 'POST', '/grooming', {
      petId: pet.id,
      queueEntryId,
      size,
      groomerId: chance(0.7) ? g.id : null,
      promisedAt: soon(120),
      services: chosen.map((careServiceId) => ({ careServiceId })),
      fleas: chance(0.15),
      ticks: chance(0.05),
      matting: chance(0.25),
      skinNotes: chance(0.15) ? 'Piel sensible en el lomo' : null,
      belongings: chance(0.4) ? pick(['Collar rojo', 'Correa azul', 'Pechera y correa', 'Ropa de abrigo']) : null,
      instructions: pick([null, 'Corte cachorro', 'Solo higiénico', 'Sin perfume', 'Dejar las orejas largas', 'Corte corto por el calor', 'Moño rosado']),
      transport,
      transportAddress: transport === 'NONE' ? null : `${pick(STREETS)} ${between(100, 999)}, ${pick(DISTRICTS)}`,
      signerName: chance(0.5) ? pet.owner : null,
      signature: null,
    });
    const order = ['BATHING', 'CUTTING', 'READY'];
    const onlyNails = chosen.length === 1 && chosen[0] === services.unas;
    for (const status of onlyNails ? ['READY'] : chosen.includes(services.corte) ? order : ['BATHING', 'READY']) {
      if (until === 'WAITING') break;
      await call(g.cookie, 'PATCH', `/grooming/${data.id}/status`, { status });
      if (status === until) break;
    }
    if (until !== 'DELIVERED') return data;
    if (chance(0.7)) await call(reception.cookie, 'POST', `/grooming/${data.id}/notify`);
    await call(reception.cookie, 'POST', `/grooming/${data.id}/deliver`, {
      pickedUpBy: pet.owner,
      pickedUpRelation: 'Propietario(a)',
    });
    return data;
  };

  // ── Historia: un día de trabajo a la vez, luego se lleva a su fecha ──
  step(`Historia de ${DAYS} días (atenciones, cobros, cierres de caja, grooming)`);
  for (let offset = -DAYS; offset < 0; offset++) {
    const d = day(offset);
    const wd = weekday(d);
    if (wd === 0) continue; // domingo cerrado
    const saturday = wd === 6;
    block = await snapshot();
    await openCash();
    // Clientes nuevos que llegan ese día
    for (let i = 0; i < (chance(0.6) ? between(1, 2) : 0); i++) await newClient();
    // Consultas
    const consults = saturday ? between(2, 4) : between(4, 7);
    for (let i = 0; i < consults; i++) {
      const pet = pickPet((p) => ['DOG', 'CAT'].includes(p.species) || chance(0.3));
      // Algunas llegan por cita
      let entry;
      if (chance(0.35)) {
        try {
          const appt = (
            await call(reception.cookie, 'POST', '/appointments', {
              petId: pet.id,
              vetId: pick(vets).id,
              startsAt: new Date(Date.now() - 60_000).toISOString(),
              durationMin: 30,
              type: 'CONSULTATION',
              reason: 'Control',
              allowOverlap: true,
            })
          ).data;
          entry = (await call(reception.cookie, 'POST', `/appointments/${appt.id}/arrive`)).data.queueEntryId;
        } catch {
          entry = undefined; // ya tenía una cita a esa hora: llega sin cita
        }
      }
      await consult(pet, { appointmentEntry: entry, urgent: !entry && chance(0.08) });
      await collectClient(pet.clientId, { partial: chance(0.07) });
    }
    // Grooming
    for (let i = 0; i < (saturday ? between(3, 5) : between(1, 3)); i++) {
      const pet = pickPet((p) => p.species === 'DOG' || (p.species === 'CAT' && chance(0.2)));
      await groom(pet);
      if (chance(0.92)) await collectClient(pet.clientId);
    }
    // Ventas de mostrador
    for (let i = 0; i < between(0, 2); i++) {
      const item = pick(['alimento', 'alimentoGato', 'snack', 'antipulgas', 'pipeta']);
      const method = payMethod();
      const price = { alimento: 89, alimentoGato: 52, snack: 6, antipulgas: 85, pipeta: 38 }[item];
      const qty = item === 'snack' ? between(2, 5) : 1;
      await call(cashier.cookie, 'POST', '/cash/counter-sales', {
        requestKey: randomUUID(),
        items: [{ productId: products[item].id, presentationId: products[item].sale, quantity: qty }],
        payments: [{ method, amount: price * qty, tendered: method === 'CASH' ? Math.ceil((price * qty) / 10) * 10 : null, operationCode: method === 'CASH' ? null : String(between(100000, 999999)) }],
        document: chance(0.5) ? 'BOLETA' : 'NOTE',
      }).catch(() => undefined); // sin stock: no hubo venta
    }
    if (chance(0.25)) await call(cashier.cookie, 'POST', '/cash/expenses', { amount: pick([12, 15, 20, 35]), reason: pick(['Bidón de agua', 'Útiles de limpieza', 'Movilidad', 'Bolsas y papel toalla']) });
    // Una cita que no vino
    if (chance(0.2)) {
      const p = pickPet();
      const appt = await call(reception.cookie, 'POST', '/appointments', { petId: p.id, vetId: pick(vets).id, startsAt: new Date(Date.now() - 60_000).toISOString(), durationMin: 30, type: 'CONSULTATION', reason: 'Control', allowOverlap: true }).catch(() => null);
      if (appt) await call(reception.cookie, 'POST', `/appointments/${appt.data.id}/no-show`).catch(() => undefined);
    }
    await closeCash();
    await shiftTo(block, d, saturday ? '09:05' : '08:40', saturday ? '13:40' : '19:30');
    // Una compra de reposición a mitad del período
    if (offset === -Math.round(DAYS / 2)) {
      block = await snapshot();
      await purchases(offset, 0.8);
      await shiftTo(block, d, '19:35', '19:50');
    }
    if (process.env.DEMO_DEBUG) console.log(d, stats.calls, stats.ms);
    process.stdout.write(`  ${d} listo\r`);
  }
  console.log('');

  // ── Hoy: la clínica funcionando ──
  step('El día de hoy: cola, consultorio, grooming, citas y caja');
  const todayBlock = await snapshot();
  await openCash();
  // Vacunas y refuerzos que tocan pronto: recordatorios con trabajo
  const due = pets.filter((p) => ['DOG', 'CAT'].includes(p.species)).slice(0, 8);
  for (const [i, p] of due.entries())
    await call(vet.cookie, 'POST', '/immunizations', {
      petId: p.id,
      kind: i % 3 === 2 ? 'DEWORMING_INTERNAL' : 'VACCINE',
      name: i % 3 === 2 ? 'Drontal Plus' : p.species === 'CAT' ? 'Triple felina' : 'Antirrábica',
      appliedAt: day(-360 + i * 3),
      nextDueAt: day(i < 3 ? -between(2, 20) : between(1, 25)),
      externalClinic: i % 2 ? 'Clínica Veterinaria San Roque' : null,
    });
  // Quién está hoy en la clínica (se eligen antes para no cruzar a una mascota en dos lugares)
  const surgeryPet = pickPet((x) => x.species === 'DOG' && x.weightKg > 8);
  const dentalPet = pickPet((x) => x.species === 'DOG' && x !== surgeryPet);
  const inConsult = pickPet((x) => x.species === 'DOG' && ![surgeryPet, dentalPet].includes(x));
  const free = (x) => ![surgeryPet, inConsult].includes(x);
  const waiting = [pickPet(free), pickPet(free), pickPet(free)];
  const groomPets = pets.filter((p) => p.species === 'DOG' && !waiting.includes(p) && ![surgeryPet, inConsult].includes(p)).slice(-6);
  // Atenciones de la mañana, cobradas
  for (let i = 0; i < 3; i++) {
    const p = pickPet((x) => ['DOG', 'CAT'].includes(x.species));
    await consult(p);
    await collectClient(p.clientId);
  }
  // Grooming en distintos estados
  await groom(groomPets[0]);
  await collectClient(groomPets[0].clientId);
  await groom(groomPets[1], { until: 'READY' });
  await groom(groomPets[2], { until: 'CUTTING' });
  await groom(groomPets[3], { until: 'BATHING' });
  await groom(groomPets[4], { until: 'WAITING' });
  // Una cirugía con presupuesto aceptado y consentimiento firmado
  const estimate = (
    await call(vet.cookie, 'POST', '/estimates', {
      petId: surgeryPet.id,
      title: 'Castración y control posoperatorio',
      validDays: 15,
      notes: 'Incluye anestesia, cirugía y un control. Ayuno de 8 horas.',
      items: [
        { careServiceId: services.hemograma, quantity: 1 },
        { careServiceId: services.castracion, quantity: 1 },
        { careServiceId: services.control, quantity: 1 },
        { productId: products.collar.id, presentationId: products.collar.sale, quantity: 1 },
      ],
    })
  ).data;
  await call(reception.cookie, 'POST', `/estimates/${estimate.id}/accept`, { note: 'Aceptó por WhatsApp' });
  const surgeryEntry = (await call(reception.cookie, 'POST', '/queue', { petId: surgeryPet.id, reason: 'Castración programada' })).data.id;
  const surgeryVisit = (await call(vet.cookie, 'POST', '/visits', { petId: surgeryPet.id, queueEntryId: surgeryEntry })).data.id;
  await call(vet.cookie, 'PATCH', `/visits/${surgeryVisit}`, { weightKg: surgeryPet.weightKg, temperatureC: 38.5, anamnesis: 'Viene en ayunas para su castración.', physicalExam: 'Apto para anestesia.', diagnosis: 'Paciente sano, apto para cirugía', diagnosisDefinitive: true, notes: 'Cirugía sin complicaciones. Collar isabelino 10 días.' });
  await call(vet.cookie, 'POST', `/estimates/${estimate.id}/convert`, { visitId: surgeryVisit }).catch(() => undefined);
  const template = (await call(vet.cookie, 'GET', `/consents/template?type=SURGERY&petId=${surgeryPet.id}&procedure=${encodeURIComponent('Orquiectomía (castración)')}`)).data;
  await call(vet.cookie, 'POST', '/consents', {
    petId: surgeryPet.id,
    visitId: surgeryVisit,
    type: 'SURGERY',
    procedure: 'Orquiectomía (castración)',
    text: template.text,
    signerName: surgeryPet.owner,
    signerDocument: null,
    signerRelation: 'Propietario(a)',
    signature: `data:image/png;base64,${signaturePng().toString('base64')}`,
  });
  const xray = new FormData();
  xray.append('kind', 'IMAGING');
  xray.append('title', 'Rx prequirúrgica');
  xray.append('visitId', String(surgeryVisit));
  xray.append('file', new Blob([xrayPng()], { type: 'image/png' }), 'rx-prequirurgica.png');
  await call(vet.cookie, 'POST', `/pets/${surgeryPet.id}/attachments`, xray);
  await call(vet.cookie, 'POST', `/visits/${surgeryVisit}/prescriptions`, {
    notes: 'Collar isabelino 10 días. Control en 7 días.',
    items: [{ productId: products.meloxicam.id, presentationId: products.meloxicam.presentations.find((p) => p.factor === 1).id, drug: 'Meloxicam 1 mg', dose: '1 tableta', route: 'Oral', frequency: 'Cada 24 horas', duration: '5 días', dispenseQuantity: 5 }],
  });
  // Otro presupuesto esperando respuesta
  await call(vet2.cookie, 'POST', '/estimates', {
    petId: dentalPet.id,
    title: 'Profilaxis dental con sedación',
    validDays: 15,
    notes: 'Requiere hemograma previo.',
    items: [{ careServiceId: services.hemograma, quantity: 1 }, { careServiceId: services.profilaxis, quantity: 1 }],
  });
  // Venta de mostrador y egreso de hoy
  await call(cashier.cookie, 'POST', '/cash/counter-sales', {
    requestKey: randomUUID(),
    items: [{ productId: products.alimento.id, presentationId: products.alimento.sale, quantity: 1 }],
    payments: [{ method: 'PLIN', amount: 89, operationCode: '7731042' }],
    document: 'BOLETA',
  });
  await call(cashier.cookie, 'POST', '/cash/expenses', { amount: 15, reason: 'Bidón de agua' });

  // Citas de hoy (más tarde) y de la semana
  for (let i = 0; i < 4; i++) {
    const p = pickPet();
    await call(reception.cookie, 'POST', '/appointments', { petId: p.id, vetId: pick(vets).id, startsAt: soon(60 + i * 45), durationMin: 30, type: 'CONSULTATION', reason: pick(['Vacuna anual', 'Control', 'Revisión de herida', 'Desparasitación']), allowOverlap: true }).catch(() => undefined);
  }
  for (let offset = 1; offset <= 6; offset++) {
    const d = day(offset);
    if (weekday(d) === 0) continue;
    for (let i = 0; i < between(3, 6); i++) {
      const p = pickPet();
      const grooming = chance(0.3) && p.species === 'DOG';
      await call(reception.cookie, 'POST', '/appointments', {
        petId: p.id,
        vetId: grooming ? pick(groomers).id : pick(vets).id,
        startsAt: limaIso(d, pick(['09:00', '09:30', '10:15', '11:00', '11:45', '15:00', '16:30', '17:15'])),
        durationMin: grooming ? 60 : 30,
        type: grooming ? 'GROOMING' : 'CONSULTATION',
        reason: grooming ? 'Baño y corte' : pick(['Vacuna anual', 'Control', 'Desparasitación', 'Chequeo geriátrico']),
        allowOverlap: true,
      }).catch(() => undefined);
    }
  }
  // En consulta ahora mismo y gente esperando
  await consult(inConsult, { closeIt: false, forcedCase: CASES[5] });
  await call(reception.cookie, 'POST', '/queue', { petId: waiting[0].id, urgent: true, reason: 'Vómitos desde anoche' });
  const second = (await call(reception.cookie, 'POST', '/queue', { petId: waiting[1].id, reason: 'Vacuna' })).data;
  await call(reception.cookie, 'PATCH', `/queue/${second.id}`, { status: 'WAITING' }).catch(() => undefined);
  await call(reception.cookie, 'POST', '/queue', { petId: waiting[2].id, reason: 'Control de piel' });
  // Lo de hoy se reparte desde la apertura hasta hace un momento
  const nowClock = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() - 3 * 60_000));
  const [nh, nm] = nowClock.split(':').map(Number);
  const startMin = Math.max(0, Math.min(8 * 60 + 40, nh * 60 + nm - 90));
  await shiftTo(todayBlock, today, `${String(Math.floor(startMin / 60)).padStart(2, '0')}:${String(startMin % 60).padStart(2, '0')}`, nowClock);

  const counts = await db.query(
    `SELECT (SELECT count(*) FROM clients WHERE clinic_id=$1) AS clients,
            (SELECT count(*) FROM pets WHERE clinic_id=$1) AS pets,
            (SELECT count(*) FROM visits WHERE clinic_id=$1) AS visits,
            (SELECT count(*) FROM receipts WHERE clinic_id=$1) AS receipts,
            (SELECT count(*) FROM grooming_sessions WHERE clinic_id=$1) AS grooming`,
    [clinicId],
  );
  const c = counts.rows[0];
  console.log(`\n✓ Demo lista: ${c.clients} clientes, ${c.pets} mascotas, ${c.visits} atenciones, ${c.receipts} cobros y ${c.grooming} servicios de grooming.`);
  console.log(`  Entran con la clave ${owner.password === DEMO_PASSWORD ? 'DEMO_PASSWORD' : 'DEMO_PASSWORD (el administrador, con la suya)'}:`);
  console.log(`  admin      ${owner.email}`);
  for (const [key, member] of Object.entries(team)) console.log(`  ${key.padEnd(10)} ${member.email} · ${member.name}`);
  await db.end();
}

main().catch(async (error) => {
  await db.end().catch(() => undefined);
  fail(error instanceof Error ? error.message : String(error));
});
