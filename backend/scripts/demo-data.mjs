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
 *   DEMO_DAYS          días de historia (por defecto 364: el año completo, así "12 meses" en
 *                      Reportes tiene movimiento de punta a punta; máximo 430; prueba rápida: 25)
 *   DEMO_RESET=1       si ya existe la clínica de demostración, la archiva y crea otra
 *   DEMO_REFRESH=1     no crea nada: trae la demo existente al día de hoy (segundos). Úsalo antes
 *                      de mostrarla: el último día de la demo pasa a ser hoy, lo de hoy queda
 *                      repartido hasta este momento y las citas pendientes, más tarde
 *   SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD
 *                      en un servidor nuevo: carga la demo en la clínica del seed (si está vacía)
 *
 * Local:    docker compose exec -e DEMO_PASSWORD=Demo2026clave api node scripts/demo-data.mjs
 * Al día:   docker compose exec -e DEMO_REFRESH=1 api node scripts/demo-data.mjs
 * Servidor: uywa exec api node scripts/demo-data.mjs
 *
 * Sin la clínica del seed vacía, crea una clínica aparte ("Veterinaria Huellitas") con su propio
 * administrador (admin@huellitas.pe): nunca se mezcla con datos reales.
 */
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import pg from 'pg';

const API = (process.env.API_URL ?? 'http://127.0.0.1:3000/api').replace(
  /\/$/,
  '',
);
const SEED_EMAIL = process.env.SEED_ADMIN_EMAIL ?? '';
const SEED_PASSWORD = process.env.SEED_ADMIN_PASSWORD ?? '';
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? '';
// 364 días: "12 meses" en Reportes empieza justo el día en que la clínica empezó a usar Uywa
// (sin un período anterior a medias que infle las comparaciones), y 7 días, 30 días y los meses
// se comparan con períodos que también tienen movimiento. La clínica crece y tiene temporadas.
const DAYS = Math.min(
  430,
  Math.max(7, Number(process.env.DEMO_DAYS ?? 364) || 364),
);

/**
 * Qué tan movido es un día: la clínica abrió con menos clientes y fue creciendo, y tiene sus
 * temporadas. En Lima el verano (enero a marzo) y diciembre llenan el grooming; el invierno
 * (junio a agosto) trae más consultas respiratorias.
 */
function busyness(iso, offset) {
  const growth = 0.62 + 0.38 * (1 - Math.min(1, -offset / Math.max(DAYS, 1)));
  const month = Number(iso.slice(5, 7));
  const consult =
    growth * ([6, 7, 8].includes(month) ? 1.15 : month === 12 ? 1.05 : 1);
  const groom =
    growth *
    (month === 12
      ? 1.45
      : [1, 2, 3].includes(month)
        ? 1.3
        : [6, 7].includes(month)
          ? 0.85
          : 1);
  return { consult, groom };
}
/** Escala una cantidad sin perder los días tranquilos (el azar decide el redondeo) */
const scaled = (n, f) => {
  const x = n * f;
  return Math.max(0, Math.floor(x) + (rand() < x - Math.floor(x) ? 1 : 0));
};
const DOMAIN = 'huellitas.pe';
const TZ = 'America/Lima';

const REFRESH = process.env.DEMO_REFRESH === '1';
if (!REFRESH && !/^(?=.*[A-Za-z])(?=.*\d).{10,100}$/.test(DEMO_PASSWORD))
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
      ...(body instanceof FormData
        ? {}
        : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    body:
      body === undefined
        ? undefined
        : body instanceof FormData
          ? body
          : JSON.stringify(body),
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
  const { res, data } = await call(null, 'POST', '/auth/login', {
    email,
    password,
  });
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
  new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
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
/** Minutos desde medianoche en Lima (ahora) */
const nowMinutes = () => {
  const [h, m] = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
    .format(new Date())
    .split(':')
    .map(Number);
  return h * 60 + m;
};
const hhmm = (min) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
/**
 * Hoy se ve como una clínica a esta hora: lo terminado entre la apertura y hace un rato, y lo
 * que está en curso (cola, consultorio, tablero de grooming) en la última hora. Si se corre muy
 * temprano, todo se comprime en las dos horas anteriores.
 */
function todayWindows() {
  const now = Math.max(30, nowMinutes() - 3);
  const open = 8 * 60 + 40;
  const doneStart = now - open >= 150 ? open : Math.max(0, now - 150);
  return {
    done: [hhmm(doneStart), hhmm(Math.max(doneStart + 5, now - 75))],
    live: [hhmm(Math.max(doneStart + 10, now - 70)), hhmm(now)],
    all: [hhmm(doneStart), hhmm(now)],
  };
}
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
/** Foto de una factura: hoja blanca con renglones y un encabezado */
function invoicePng() {
  return png(300, 400, (x, y) => {
    const header = y > 24 && y < 64 && x > 24 && x < 180;
    const line = y > 100 && y < 360 && (y - 100) % 22 < 2 && x > 24 && x < 276;
    const total = y > 364 && y < 380 && x > 180 && x < 276;
    const ink = header || line || total;
    return ink ? [60, 64, 80, 255] : [250, 250, 247, 255];
  });
}
/** Firma: un trazo ondulado */
function signaturePng() {
  return png(360, 120, (x, y) => {
    const curve =
      60 +
      Math.sin(x / 14) * 22 * Math.sin(x / 90) +
      (x > 250 ? (x - 250) * 0.15 : 0);
    const ink = x > 30 && x < 330 && Math.abs(y - curve) < 1.8;
    return ink ? [15, 23, 42, 255] : [0, 0, 0, 0];
  });
}
/** Imagen gris con una silueta clara, como una radiografía */
function xrayPng() {
  return png(320, 240, (x, y) => {
    const bone =
      Math.abs(y - 120 - Math.sin(x / 40) * 10) < 9 || Math.abs(x - 160) < 6;
    const v = bone ? 220 : 40 + ((x * 7 + y * 3) % 25);
    return [v, v, v, 255];
  });
}

// ── Datos base ──
const FIRST_F = [
  'María',
  'Rosa',
  'Carmen',
  'Ana',
  'Lucía',
  'Sofía',
  'Valeria',
  'Elena',
  'Patricia',
  'Gabriela',
  'Daniela',
  'Fiorella',
  'Milagros',
  'Katherine',
  'Jimena',
  'Andrea',
  'Claudia',
  'Rocío',
  'Yesenia',
  'Liliana',
];
const FIRST_M = [
  'José',
  'Luis',
  'Carlos',
  'Jorge',
  'Miguel',
  'Pedro',
  'Diego',
  'Juan',
  'Ricardo',
  'Renzo',
  'Alonso',
  'Víctor',
  'Raúl',
  'Óscar',
  'Fernando',
  'Christian',
  'Walter',
  'César',
  'Martín',
  'Hugo',
];
const LAST = [
  'Quispe',
  'Mamani',
  'Huamán',
  'Flores',
  'Rojas',
  'Torres',
  'Vargas',
  'Ramos',
  'Castillo',
  'Chávez',
  'Gutiérrez',
  'Salazar',
  'Paredes',
  'Medina',
  'Díaz',
  'Mendoza',
  'Ruiz',
  'Vílchez',
  'Ccori',
  'Cruz',
  'Soto',
  'León',
  'Pérez',
  'Gómez',
  'Cáceres',
  'Ríos',
  'Espinoza',
  'Aguilar',
  'Palomino',
  'Ticona',
];
const STREETS = [
  'Av. Lima',
  'Jr. Arequipa',
  'Av. Las Flores',
  'Calle Los Olivos',
  'Av. Carapongo',
  'Jr. Huancayo',
  'Av. Nicolás Ayllón',
  'Calle San Martín',
];
const DISTRICTS = ['Chosica', 'Lurigancho', 'Chaclacayo', 'Ate', 'Santa Anita'];
const DOG_NAMES = [
  'Toby',
  'Max',
  'Rocky',
  'Bruno',
  'Firulais',
  'Canela',
  'Lola',
  'Coco',
  'Bobby',
  'Zeus',
  'Thor',
  'Princesa',
  'Chispa',
  'Manchas',
  'Oso',
  'Duque',
  'Kira',
  'Simba',
  'Rex',
  'Negrita',
  'Pancho',
  'Chocolate',
  'Bella',
  'Mía',
  'Tito',
  'Peluchín',
  'Hachi',
  'Lucky',
  'Sasha',
  'Benji',
  'Rambo',
  'Luna',
  'Panchito',
  'Bruce',
  'Nina',
  'Chester',
  'Frida',
  'Bolt',
  'Molly',
  'Tyson',
  'Lassie',
  'Pepa',
  'Scooby',
  'Choco',
  'Milo',
  'Dante',
  'Kaiser',
  'Greta',
  'Rufo',
  'Chiquita',
  'Apolo',
  'Maya',
  'Roco',
  'Fiona',
  'Bambú',
  'Toffee',
  'Gringo',
  'Lulú',
  'Napo',
  'Olivia',
  'Pirulo',
  'Ramona',
  'Sansón',
  'Trufa',
  'Vito',
  'Yako',
  'Zarina',
  'Boris',
  'Candy',
  'Draco',
];
const CAT_NAMES = [
  'Mishi',
  'Michi',
  'Garfield',
  'Tom',
  'Nieve',
  'Salem',
  'Mimi',
  'Félix',
  'Kitty',
  'Sombra',
  'Tigre',
  'Misifú',
  'Lucas',
  'Oreo',
  'Cleo',
  'Gatubela',
  'Pelusa',
  'Nala',
  'Pantera',
  'Kiara',
  'Mostaza',
  'Romeo',
  'Bigotes',
  'Simón',
  'Pirata',
  'Tomasa',
  'Pompón',
  'Minina',
  'Copo',
  'Chimuelo',
  'Matilda',
  'Ozzy',
  'Perla',
  'Rayito',
  'Sushi',
  'Tango',
];
const DOG_BREEDS = [
  ['Mestizo', 8, 25],
  ['Shih tzu', 5, 8],
  ['Poodle', 4, 8],
  ['Schnauzer', 6, 10],
  ['Labrador', 25, 36],
  ['Golden retriever', 25, 34],
  ['Pitbull', 20, 30],
  ['Bulldog francés', 9, 13],
  ['Pastor alemán', 28, 40],
  ['Chihuahua', 1.5, 3],
  ['Beagle', 9, 14],
  ['Yorkshire', 2, 4],
  ['Cocker spaniel', 11, 15],
  ['Husky siberiano', 20, 27],
  ['Rottweiler', 38, 50],
];
const CAT_BREEDS = [
  ['Común europeo', 3.5, 5.5],
  ['Siamés', 3, 5],
  ['Persa', 3.5, 5.5],
  ['Angora', 3, 5],
];

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
  const species =
    roll < 0.62
      ? 'DOG'
      : roll < 0.92
        ? 'CAT'
        : pick(['RABBIT', 'GUINEA_PIG', 'BIRD']);
  let name;
  const pool = species === 'CAT' ? CAT_NAMES : DOG_NAMES;
  // Sin repetir nombres mientras queden libres en la lista de esa especie
  const free = pool.filter((n) => !usedNames.has(n));
  name = free.length ? pick(free) : pick(pool);
  usedNames.add(name);
  if (species === 'DOG') {
    const [breed, min, max] = pick(DOG_BREEDS);
    return {
      name,
      species,
      breed,
      sex: chance(0.5) ? 'MALE' : 'FEMALE',
      neutered: chance(0.4),
      birthDate: yearsAgo(round1(0.5 + rand() * 11)),
      weightKg: round1(min + rand() * (max - min)),
    };
  }
  if (species === 'CAT') {
    const [breed, min, max] = pick(CAT_BREEDS);
    return {
      name,
      species,
      breed,
      sex: chance(0.5) ? 'MALE' : 'FEMALE',
      neutered: chance(0.6),
      birthDate: yearsAgo(round1(0.5 + rand() * 12)),
      weightKg: round1(min + rand() * (max - min)),
    };
  }
  const exotic = {
    RABBIT: ['Cabeza de león', 1.5],
    GUINEA_PIG: ['Peruano', 1],
    BIRD: ['Periquito', 0.05],
  }[species];
  const exoticNames = [
    'Copito',
    'Kiwi',
    'Algodón',
    'Pipo',
    'Tambor',
    'Nube',
    'Pistacho',
    'Mango',
    'Paco',
    'Lorenzo',
  ].filter((n) => !usedNames.has(n));
  const exoticName = exoticNames.length
    ? pick(exoticNames)
    : `Pipo ${usedNames.size}`;
  usedNames.add(exoticName);
  return {
    name: exoticName,
    species,
    breed: exotic[0],
    sex: chance(0.5) ? 'MALE' : 'FEMALE',
    birthDate: yearsAgo(round1(0.5 + rand() * 3)),
    weightKg: exotic[1],
  };
}

// Consultas que se repiten en una clínica real (S, O, A, P)
const CASES = [
  {
    reason: 'Vacuna anual',
    vaccine: true,
    anamnesis: 'Viene por su vacuna anual. Come bien, sin vómitos ni diarrea.',
    exam: 'Buen estado general. Sin hallazgos.',
    dx: 'Paciente sano',
    definitive: true,
    plan: 'Se aplica la vacuna. Próxima dosis en un año.',
  },
  {
    reason: 'Control general',
    anamnesis: 'Control de rutina, el dueño no reporta molestias.',
    exam: 'Mucosas rosadas, auscultación normal.',
    dx: 'Paciente sano',
    definitive: true,
    plan: 'Mantener alimentación y desparasitación al día.',
  },
  {
    reason: 'Picazón y caída de pelo',
    anamnesis: 'Se rasca mucho hace una semana.',
    exam: 'Eritema y pápulas en zona lumbar, presencia de pulgas.',
    dx: 'Dermatitis alérgica por pulgas',
    definitive: false,
    plan: 'Antipulgas hoy y a todos los animales de la casa. Control en 15 días.',
    rx: ['Prednisolona 5 mg', '1/2 tableta', 'Cada 24 horas', '5 días'],
    antipulgas: true,
  },
  {
    reason: 'Se sacude las orejas',
    anamnesis: 'Mal olor en el oído derecho desde hace 4 días.',
    exam: 'Otitis externa derecha, secreción marrón.',
    dx: 'Otitis externa',
    definitive: false,
    plan: 'Limpieza ótica y gotas por 7 días.',
    rx: ['Otomax gotas', '5 gotas', 'Cada 12 horas', '7 días'],
  },
  {
    reason: 'Vómitos y diarrea',
    anamnesis: 'Vomitó 3 veces desde anoche, comió basura.',
    exam: 'Dolor leve a la palpación abdominal, deshidratación 5 %.',
    dx: 'Gastroenteritis aguda',
    definitive: false,
    plan: 'Fluidos subcutáneos, dieta blanda 3 días.',
    rx: ['Metoclopramida 10 mg', '1/4 tableta', 'Cada 8 horas', '3 días'],
    fluids: true,
  },
  {
    reason: 'Cojea de una pata',
    anamnesis: 'Cojea desde ayer después de jugar en el parque.',
    exam: 'Dolor a la flexión de la rodilla, sin inflamación.',
    dx: 'Esguince',
    definitive: false,
    plan: 'Reposo 7 días. Antiinflamatorio.',
    meloxicam: true,
  },
  {
    reason: 'Desparasitación',
    deworm: true,
    anamnesis: 'Toca desparasitación interna.',
    exam: 'Buen estado general.',
    dx: 'Paciente sano',
    definitive: true,
    plan: 'Se desparasita. Repetir en 3 meses.',
  },
  {
    reason: 'Chequeo geriátrico',
    anamnesis: 'Perro mayor, toma más agua de lo normal.',
    exam: 'Sarro dental grado 2, soplo leve.',
    dx: 'Enfermedad periodontal',
    definitive: false,
    plan: 'Análisis de sangre y profilaxis dental programada.',
    lab: true,
  },
];

// ── Base de datos: crear la clínica aparte y llevar cada día a su fecha ──
// Sesión en UTC, igual que la API (ver PrismaService)
const db = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  options: '-c timezone=UTC',
});
let clinicId = 0;

/** Tablas de la clínica cuyos registros nuevos de cada día se mueven a su fecha */
let SHIFT_TABLES = [];
/** Columnas que no se tocan (no dependen del día en que se registran) */
const KEEP_COLUMNS = new Set([
  'birth_date',
  'deceased_at',
  'expires_at',
  'updated_at',
  'logo_updated_at',
  'locked_until',
  'last_login_at',
]);
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
    const { rows } = await db.query(
      `SELECT coalesce(max(id), 0) AS id FROM "${t.table}" WHERE clinic_id = $1`,
      [clinicId],
    );
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
  const offsetDays = Math.round(
    (new Date(`${today}T12:00:00Z`) - new Date(`${target}T12:00:00Z`)) /
      86_400_000,
  );
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
      [
        clinicId,
        base.toISOString(),
        start.at.toISOString(),
        factor,
        start.snap[t.table],
      ],
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
  if (process.env.DEMO_DEBUG)
    console.log('shift ms', Date.now() - t0, 'snapshot→end', end - start.at);
}

async function prepareClinic() {
  // Servidor nuevo: la clínica del seed, si está vacía
  // (si esa cuenta ya cambió su clave, se sigue con la demo de siempre)
  const seed =
    SEED_EMAIL && SEED_PASSWORD
      ? await login(SEED_EMAIL, SEED_PASSWORD).catch(() => null)
      : null;
  if (seed) {
    const existing = await call(seed.cookie, 'GET', '/clients?status=all');
    if (existing.data.total === 0) {
      clinicId = seed.user.clinic.id;
      return {
        cookie: seed.cookie,
        email: SEED_EMAIL,
        password: '(su clave de siempre)',
      };
    }
    step(
      'La clínica del seed ya tiene clientes: se crea una clínica de demostración aparte',
    );
  }
  const email = `admin@${DOMAIN}`;
  const { rows } = await db.query(
    'SELECT id, clinic_id FROM users WHERE email = $1',
    [email],
  );
  if (rows.length) {
    // Una demo que quedó a medias (sin clientes) se rehace sola
    const { rows: done } = await db.query(
      'SELECT count(*)::int AS n FROM clients WHERE clinic_id = $1',
      [rows[0].clinic_id],
    );
    if (done[0].n > 0 && process.env.DEMO_RESET !== '1')
      fail(
        `La demostración ya existe (${email}). Para crearla de nuevo, agrega -e DEMO_RESET=1.`,
      );
    const old = rows[0].clinic_id;
    step('Archivando la demostración anterior');
    await db.query(
      `UPDATE users SET email = 'archivo-' || id || '-' || email, active = false WHERE clinic_id = $1`,
      [old],
    );
    await db.query(
      `UPDATE clinics SET active = false, name = name || ' (archivada)' WHERE id = $1`,
      [old],
    );
  }
  const clinic = await db.query(
    `INSERT INTO clinics (name, ruc, address, phone, email, updated_at) VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
    [
      'Veterinaria Huellitas',
      CLINIC_RUC,
      'Av. Lima 245, Chosica',
      '987 000 111',
      `hola@${DOMAIN}`,
    ],
  );
  clinicId = clinic.rows[0].id;
  await db.query(
    // La dueña también atiende: con su colegiatura puede recetar en la demostración
    `INSERT INTO users (clinic_id, full_name, email, password_hash, role, license_number, updated_at) VALUES ($1, $2, $3, $4, 'ADMIN', '06233', now())`,
    [
      clinicId,
      'Andrea Salazar Ríos',
      email,
      await bcrypt.hash(DEMO_PASSWORD, 10),
    ],
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

/**
 * Trae la demo existente al día de hoy sin crear nada: corre todas sus fechas los días que
 * pasaron desde que se generó, reparte lo de hoy hasta este momento y deja las citas y recojos
 * pendientes más tarde. Así la demo se ve viva el día que se muestra.
 */
async function refresh() {
  await db.connect();
  await loadShiftTables();
  const { rows } = await db.query(
    `SELECT clinic_id FROM users WHERE active AND (email = $1 OR email LIKE 'demo.vet@%') ORDER BY (email = $1) DESC LIMIT 1`,
    [`admin@${DOMAIN}`],
  );
  if (!rows.length)
    fail(
      'No hay una demostración que actualizar. Créala primero con DEMO_PASSWORD.',
    );
  clinicId = rows[0].clinic_id;
  const last = await db.query(
    `SELECT to_char(max(day), 'YYYY-MM-DD') AS day FROM queue_entries WHERE clinic_id = $1`,
    [clinicId],
  );
  const lastDay = last.rows[0].day;
  if (!lastDay) fail('La demostración no tiene días cargados.');
  const days = Math.round(
    (new Date(`${today}T12:00:00Z`) - new Date(`${lastDay}T12:00:00Z`)) /
      86_400_000,
  );
  step(
    days > 0
      ? `La demo es del ${lastDay}: se corre ${days} ${days === 1 ? 'día' : 'días'} hasta hoy`
      : 'La demo ya es de hoy: se ajustan las horas',
  );
  // Al refrescar sí se corren los vencimientos (siguen "venciendo en 24 días")
  const keep = new Set([
    'birth_date',
    'deceased_at',
    'logo_updated_at',
    'locked_until',
    'last_login_at',
  ]);
  await db.query('BEGIN');
  if (days !== 0)
    for (const t of SHIFT_TABLES) {
      const cols = [
        ...t.cols,
        ...(t.table === 'product_batches' ? ['expires_at'] : []),
      ].filter((c) => !keep.has(c));
      if (!cols.length) continue;
      const sets = cols.map((c) =>
        t.dates.has(c) || c === 'expires_at'
          ? `"${c}" = "${c}" + ${days}`
          : `"${c}" = "${c}" + interval '${days} days'`,
      );
      await db.query(
        `UPDATE "${t.table}" SET ${sets.join(', ')} WHERE clinic_id = $1`,
        [clinicId],
      );
    }
  // Lo de hoy: de su primera a su última hora → de la apertura a este momento (mismo orden)
  const dayStart = new Date(limaIso(today, '00:00'));
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const span = await db.query(
    `SELECT min(t) AS lo, max(t) AS hi FROM (
       SELECT arrived_at AS t FROM queue_entries WHERE clinic_id = $1 AND day = $2::date
       UNION ALL SELECT created_at FROM receipts WHERE clinic_id = $1 AND created_at >= $3 AND created_at < $4
       UNION ALL SELECT check_in_at FROM grooming_sessions WHERE clinic_id = $1 AND check_in_at >= $3 AND check_in_at < $4) x`,
    [clinicId, today, dayStart, dayEnd],
  );
  const { lo, hi } = span.rows[0];
  if (lo && hi) {
    const w = todayWindows().all;
    const base = new Date(limaIso(today, w[0]));
    const factor =
      (new Date(limaIso(today, w[1])) - base) / Math.max(60_000, hi - lo);
    for (const t of SHIFT_TABLES)
      for (const c of t.cols) {
        if (t.dates.has(c) || FUTURE_COLUMNS.has(c) || keep.has(c)) continue;
        // La hoja de tratamiento se alinea aparte (sus horas programadas no se estiran)
        if (
          t.table.startsWith('hospitalization') ||
          t.table === 'clinical_templates'
        )
          continue;
        await db.query(
          `UPDATE "${t.table}" SET "${c}" = $2::timestamptz + ("${c}" - $3::timestamptz) * $4::float8
           WHERE clinic_id = $1 AND "${c}" >= $5 AND "${c}" < $6`,
          [clinicId, base, lo, factor, dayStart, dayEnd],
        );
      }
  }
  await fixTodayPlans();
  await markExpiringLot();
  await alignHospitalization(days);
  await db.query('COMMIT');
  console.log('\n✓ Demo al día. Recarga la página (Ctrl+Shift+R).');
  await db.end();
}

/** Citas que llegaron a su hora de llegada; las pendientes de hoy, más tarde; recojos de grooming, en 1 a 2 horas */
async function fixTodayPlans() {
  await db.query(
    `UPDATE appointments a SET starts_at = to_timestamp(floor(extract(epoch FROM q.arrived_at) / 900) * 900)
     FROM queue_entries q WHERE a.queue_entry_id = q.id AND a.clinic_id = $1 AND q.day = $2::date`,
    [clinicId, today],
  );
  const dayStart = new Date(limaIso(today, '00:00'));
  const pending = await db.query(
    `SELECT id FROM appointments WHERE clinic_id = $1 AND status IN ('SCHEDULED','CONFIRMED')
       AND starts_at >= $2 AND starts_at < $3 ORDER BY starts_at, id`,
    [clinicId, dayStart, new Date(dayStart.getTime() + 86_400_000)],
  );
  const now = nowMinutes();
  for (const [i, r] of pending.rows.entries()) {
    // Cada 45 minutos desde la próxima media hora, sin pasar de medianoche
    const at = Math.min(23 * 60 + 45, Math.ceil((now + 30) / 15) * 15 + i * 45);
    await db.query(`UPDATE appointments SET starts_at = $2 WHERE id = $1`, [
      r.id,
      limaIso(today, hhmm(at)),
    ]);
  }
  await db.query(
    `UPDATE grooming_sessions SET promised_at = now() + (interval '1 minute' * (60 + (id % 4) * 30))
     WHERE clinic_id = $1 AND status IN ('WAITING','BATHING','CUTTING','READY')`,
    [clinicId],
  );
}

/** Un lote de triple felina que vence en 18 días: "por vencer" en el inventario y en los avisos */
async function markExpiringLot() {
  await db.query(
    `UPDATE product_batches SET expires_at = $2 WHERE id = (
       SELECT b.id FROM product_batches b JOIN products p ON p.id = b.product_id
       WHERE b.clinic_id = $1 AND p.name = 'Vacuna triple felina' AND b.quantity > 0 ORDER BY b.id LIMIT 1)`,
    [clinicId, day(18)],
  );
}

// ── Plantillas clínicas ──

async function seedTemplates(cookie, products) {
  const consultations = [
    [
      'Vacuna anual',
      {
        reason: 'Vacuna anual',
        anamnesis:
          'Viene por su vacuna anual. Come bien, sin vómitos ni diarrea. Desparasitado hace menos de 3 meses.',
        physicalExam:
          'Buen estado general. Mucosas rosadas, TLLC < 2 s. Auscultación cardiopulmonar normal. Linfonodos normales.',
        diagnosis: 'Paciente sano',
        plan: 'Se aplica la vacuna. Próxima dosis en 1 año. Control de peso en la próxima visita.',
      },
      34,
    ],
    [
      'Gastroenteritis aguda',
      {
        reason: 'Vómitos y diarrea',
        anamnesis:
          'Vómitos desde hace __ horas, __ episodios. Diarrea sin/con sangre. Apetito disminuido. ¿Comió algo fuera de lo normal?',
        physicalExam:
          'Dolor a la palpación abdominal. Deshidratación __ %. Mucosas __.',
        diagnosis: 'Gastroenteritis aguda',
        plan: 'Fluidoterapia, antiemético y protector gástrico. Ayuno de 12 h y luego dieta blanda (pollo sancochado y arroz) por 3 días. Volver si vomita de nuevo o hay sangre.',
      },
      21,
    ],
    [
      'Otitis externa',
      {
        reason: 'Se sacude las orejas',
        anamnesis:
          'Se rasca y sacude la cabeza. Mal olor en el oído desde hace __ días.',
        physicalExam:
          'Conducto auditivo eritematoso, secreción marrón/purulenta. Dolor a la manipulación del pabellón.',
        diagnosis: 'Otitis externa',
        plan: 'Limpieza ótica en consulta. Gotas óticas cada 12 h por 7 días. Control en 10 días.',
      },
      15,
    ],
    [
      'Dermatitis por pulgas',
      {
        reason: 'Picazón y caída de pelo',
        anamnesis:
          'Prurito intenso desde hace __ días. Convive con otros animales.',
        physicalExam:
          'Eritema y pápulas en región lumbosacra. Presencia de pulgas y heces de pulga.',
        diagnosis: 'Dermatitis alérgica por picadura de pulgas',
        plan: 'Antipulgas hoy y a todos los animales de la casa. Limpieza del ambiente. Control en 15 días.',
      },
      12,
    ],
    [
      'Esguince o cojera',
      {
        reason: 'Cojea de una pata',
        anamnesis:
          'Cojea desde __ después de jugar/caerse. Sin trauma evidente.',
        physicalExam:
          'Claudicación grado __/4 del miembro __. Dolor a la flexión, sin crepitación ni inestabilidad.',
        diagnosis: 'Esguince',
        plan: 'Reposo estricto 7 días, paseos cortos con correa. Antiinflamatorio 5 días. Radiografía si no mejora.',
      },
      9,
    ],
    [
      'Chequeo geriátrico',
      {
        reason: 'Chequeo geriátrico',
        anamnesis:
          'Paciente mayor. ¿Toma más agua, orina más, baja de peso, tose?',
        physicalExam:
          'Condición corporal __/9. Sarro dental grado __. Auscultación: __.',
        diagnosis: 'Control geriátrico',
        plan: 'Hemograma y bioquímica. Evaluar profilaxis dental. Control cada 6 meses.',
      },
      6,
    ],
  ];
  for (const [name, consultation, uses] of consultations) {
    const { data } = await call(cookie, 'POST', '/clinical-templates', {
      kind: 'CONSULTATION',
      name,
      consultation,
    });
    await db.query(
      'UPDATE clinical_templates SET usage_count = $2 WHERE id = $1',
      [data.id, uses],
    );
  }
  const sale = (key) =>
    products[key] && {
      productId: products[key].id,
      presentationId: products[key].presentations.at(-1).id,
    };
  const prescriptions = [
    [
      'Otitis externa',
      {
        notes: 'Limpiar el oído antes de cada aplicación. No bañar por 7 días.',
        items: [
          {
            drug: 'Otomax (gotas óticas)',
            dose: '5 gotas',
            route: 'Ótica',
            frequency: 'Cada 12 horas',
            duration: '7 días',
            instructions: 'Masajear la base de la oreja',
          },
        ],
      },
      14,
    ],
    [
      'Dolor e inflamación',
      {
        notes: 'Dar con comida. Suspender si vomita o tiene heces negras.',
        items: [
          {
            ...sale('meloxicam'),
            drug: 'Meloxicam 1 mg',
            dose: '0.1 mg/kg',
            route: 'Oral',
            frequency: 'Cada 24 horas',
            duration: '5 días',
            instructions: 'Con comida',
            dispenseQuantity: 1,
          },
        ],
      },
      11,
    ],
    [
      'Infección de piel',
      {
        items: [
          {
            ...sale('amoxicilina'),
            drug: 'Amoxicilina 250 mg',
            dose: '20 mg/kg',
            route: 'Oral',
            frequency: 'Cada 12 horas',
            duration: '10 días',
            instructions: 'Completar el tratamiento aunque mejore',
            dispenseQuantity: 2,
          },
          {
            drug: 'Champú de clorhexidina 2 %',
            dose: 'Baño',
            route: 'Tópica',
            frequency: 'Cada 3 días',
            duration: '3 semanas',
            instructions: 'Dejar actuar 10 minutos antes de enjuagar',
          },
        ],
      },
      8,
    ],
    [
      'Gastroenteritis (casa)',
      {
        notes:
          'Ayuno de 12 horas, luego dieta blanda en porciones pequeñas por 3 días.',
        items: [
          {
            drug: 'Metronidazol 250 mg',
            dose: '15 mg/kg',
            route: 'Oral',
            frequency: 'Cada 12 horas',
            duration: '5 días',
          },
          {
            drug: 'Omeprazol 20 mg',
            dose: '1 mg/kg',
            route: 'Oral',
            frequency: 'Cada 24 horas',
            duration: '5 días',
            instructions: 'En ayunas',
          },
        ],
      },
      7,
    ],
    [
      'Pulgas (perro 10-20 kg)',
      {
        items: [
          {
            ...sale('antipulgas'),
            drug: 'Antipulgas masticable 10-20 kg',
            dose: '1 tableta',
            route: 'Oral',
            frequency: 'Una sola vez',
            duration: 'Repetir en 3 meses',
            dispenseQuantity: 1,
          },
        ],
      },
      5,
    ],
  ];
  for (const [name, prescription, uses] of prescriptions) {
    prescription.items = prescription.items.map((i) =>
      Object.fromEntries(Object.entries(i).filter(([, v]) => v !== undefined)),
    );
    const { data } = await call(cookie, 'POST', '/clinical-templates', {
      kind: 'PRESCRIPTION',
      name,
      prescription,
    });
    await db.query(
      'UPDATE clinical_templates SET usage_count = $2 WHERE id = $1',
      [data.id, uses],
    );
  }
}

// ── Hospitalización ──

const HOUR_MS = 3_600_000;

/**
 * Dos internados con su hoja al día (salvo una dosis atrasada para mostrar el aviso) y un alta
 * de ayer. Lo que ya pasó se escribe directo con sus horas reales.
 */
async function seedHospital({
  cookie,
  staff,
  stayServiceId,
  services,
  dog,
  cat,
  past,
}) {
  const now = Date.now();
  // Horas redondas (al cuarto de hora), como se programan en la clínica
  const quarter = (t) => Math.floor(t / 900_000) * 900_000;
  const plans = [
    {
      pet: dog,
      hoursAgo: 44,
      cage: 'J-1',
      reason: 'Gastroenteritis hemorrágica',
      diagnosis: 'Gastroenteritis hemorrágica, deshidratación 8 %',
      orders: [
        {
          kind: 'FLUIDS',
          description: 'Lactato de Ringer',
          dose: '40 ml/h',
          route: 'IV',
          everyHours: 6,
          startH: 0.5,
          notes: 'Revisar vía y bomba en cada control',
        },
        // Su última dosis quedó atrasada (hace 45 min): así se ve el aviso
        {
          kind: 'MEDICATION',
          description: 'Metronidazol',
          dose: '15 mg/kg',
          route: 'IV',
          everyHours: 12,
          startAt: quarter(now - 45 * 60_000) - 36 * HOUR_MS,
          overdue: true,
        },
        {
          kind: 'MEDICATION',
          description: 'Maropitant (Cerenia)',
          dose: '1 mg/kg',
          route: 'SC',
          everyHours: 24,
          startH: 1,
        },
        {
          kind: 'MEDICATION',
          description: 'Omeprazol',
          dose: '1 mg/kg',
          route: 'IV',
          everyHours: 24,
          startH: 1.5,
        },
        {
          kind: 'FEEDING',
          description: 'Dieta gastrointestinal, porciones pequeñas',
          dose: '50 g',
          route: 'Oral',
          everyHours: 6,
          startH: 26,
        },
      ],
      temps: [39.9, 39.7, 39.4, 39.1, 38.9, 38.7, 38.8, 38.6],
      heart: [148, 140, 132, 126, 120, 116, 112, 110],
      mucosa: [
        'Pálidas',
        'Pálidas',
        'Pálidas',
        'Rosadas',
        'Rosadas',
        'Rosadas',
        'Rosadas',
        'Rosadas',
      ],
      notes: [
        [
          2,
          'Ingresa decaído, vómitos con sangre y diarrea. Se coloca vía periférica en miembro anterior derecho.',
        ],
        [
          20,
          'Sin vómitos desde hace 8 horas. Se inicia alimentación en poca cantidad.',
        ],
        [
          38,
          'Más activo, mueve la cola. Comió toda la porción. Heces pastosas, sin sangre.',
        ],
      ],
      skip: {
        order: 4,
        index: 0,
        note: 'No quiso comer, se ofrece en la siguiente toma',
      },
      charges: [
        [services.hemograma, 2],
        [services.fluidos, 1],
        [services.emergencia, 1],
      ],
    },
    {
      pet: cat,
      hoursAgo: 7,
      cage: 'G-2',
      reason: 'Obstrucción urinaria',
      diagnosis: 'Obstrucción uretral; sondaje vesical',
      orders: [
        {
          kind: 'FLUIDS',
          description: 'Cloruro de sodio 0.9 %',
          dose: '15 ml/h',
          route: 'IV',
          everyHours: 6,
          startH: 0.5,
        },
        {
          kind: 'MEDICATION',
          description: 'Buprenorfina',
          dose: '0.02 mg/kg',
          route: 'IV',
          everyHours: 8,
          startH: 1,
        },
        {
          kind: 'MONITORING',
          description: 'Control de diuresis por sonda',
          dose: 'Medir y anotar ml',
          everyHours: 4,
          startH: 1,
        },
        {
          kind: 'MEDICATION',
          description: 'Amoxicilina con ácido clavulánico',
          dose: '12.5 mg/kg',
          route: 'Oral',
          everyHours: 12,
          startH: 2,
        },
      ],
      temps: [38.1, 38.4],
      heart: [210, 188],
      mucosa: ['Rosadas', 'Rosadas'],
      notes: [
        [
          1,
          'Se desobstruye con sonda bajo sedación. Orina con sangre. Vejiga distendida.',
        ],
      ],
      charges: [
        [services.emergencia, 1],
        [services.hemograma, 1],
      ],
    },
  ];
  const ids = [];
  for (const plan of plans) {
    if (!plan.pet) continue;
    const admittedAt = quarter(now - plan.hoursAgo * HOUR_MS);
    const { data: h } = await call(cookie, 'POST', '/hospitalizations', {
      petId: plan.pet.id,
      cage: plan.cage,
      reason: plan.reason,
      diagnosis: plan.diagnosis,
    });
    ids.push(h.id);
    await db.query(
      'UPDATE hospitalizations SET admitted_at = $2 WHERE id = $1',
      [h.id, new Date(admittedAt)],
    );
    await db.query('UPDATE visits SET opened_at = $2 WHERE id = $1', [
      h.visitId,
      new Date(admittedAt),
    ]);
    for (const [i, order] of plan.orders.entries()) {
      const { data } = await call(
        cookie,
        'POST',
        `/hospitalizations/${h.id}/orders`,
        {
          kind: order.kind,
          description: order.description,
          dose: order.dose ?? null,
          route: order.route ?? null,
          everyHours: order.everyHours,
          notes: order.notes ?? null,
        },
      );
      const created = data.orders.find(
        (o) => o.description === order.description,
      );
      const startsAt = order.startAt ?? admittedAt + order.startH * HOUR_MS;
      await db.query(
        'UPDATE hospitalization_orders SET starts_at = $2, created_at = $3 WHERE id = $1',
        [created.id, new Date(startsAt), new Date(Math.min(startsAt, now))],
      );
      // Lo que tocó hasta hace 25 min se dio (con unos minutos de diferencia); la marcada como
      // atrasada deja sin registrar su última hora
      const until = order.overdue ? now - 60 * 60_000 : now - 25 * 60_000;
      let index = 0;
      for (
        let t = startsAt;
        t < until;
        t += order.everyHours * HOUR_MS, index++
      ) {
        const skipped = Boolean(
          plan.skip && plan.skip.order === i && plan.skip.index === index,
        );
        await db.query(
          `INSERT INTO hospitalization_entries (clinic_id, hospitalization_id, kind, order_id, scheduled_at, at, skipped, notes, by_id)
           VALUES ($1, $2, 'DOSE', $3, $4, $5, $6, $7, $8)`,
          [
            clinicId,
            h.id,
            created.id,
            new Date(t),
            new Date(Math.min(now - 60_000, t + between(2, 18) * 60_000)),
            skipped,
            skipped ? plan.skip.note : null,
            pick(staff),
          ],
        );
      }
    }
    // Lo usado en el internamiento ya está en su cuenta
    await call(cookie, 'POST', '/charges', {
      visitId: h.visitId,
      items: plan.charges.map(([careServiceId, quantity]) => ({
        careServiceId,
        quantity,
      })),
    }).catch(() => undefined);
    // Signos cada 6 h desde el ingreso
    for (const [i, temp] of plan.temps.entries()) {
      const at = admittedAt + (0.25 + i * 6) * HOUR_MS + between(0, 4) * 60_000;
      if (at > now - 20 * 60_000) break;
      await db.query(
        `INSERT INTO hospitalization_entries (clinic_id, hospitalization_id, kind, at, temperature_c, heart_rate, respiratory_rate, mucosa, by_id)
         VALUES ($1, $2, 'VITALS', $3, $4, $5, $6, $7, $8)`,
        [
          clinicId,
          h.id,
          new Date(at),
          temp,
          plan.heart[i],
          between(20, 32),
          plan.mucosa[i],
          pick(staff),
        ],
      );
    }
    for (const [hours, text] of plan.notes)
      await db.query(
        `INSERT INTO hospitalization_entries (clinic_id, hospitalization_id, kind, at, notes, by_id) VALUES ($1, $2, 'NOTE', $3, $4, $5)`,
        [
          clinicId,
          h.id,
          new Date(admittedAt + hours * HOUR_MS),
          text,
          staff[0],
        ],
      );
  }

  // Un alta de ayer: 2 días cobrados, queda en "Altas recientes"
  if (past) {
    const { data: h } = await call(cookie, 'POST', '/hospitalizations', {
      petId: past.id,
      cage: 'J-3',
      reason: 'Posoperatorio de piometra',
      diagnosis: 'Piometra; ovariohisterectomía',
    });
    await call(cookie, 'POST', `/hospitalizations/${h.id}/orders`, {
      kind: 'MEDICATION',
      description: 'Tramadol',
      dose: '2 mg/kg',
      route: 'IV',
      everyHours: 8,
    });
    await call(cookie, 'POST', `/hospitalizations/${h.id}/discharge`, {
      outcome: 'DISCHARGED',
      careServiceId: stayServiceId,
      days: 2,
      notes:
        'Meloxicam por 5 días, collar isabelino y control en 7 días para retirar puntos.',
    });
    const out = new Date(limaIso(day(-1), '17:20'));
    const shift = `interval '1 second' * (extract(epoch FROM $2::timestamptz) - extract(epoch FROM now()))`;
    await db.query(
      `UPDATE hospitalizations SET admitted_at = $2::timestamptz - interval '50 hours', discharged_at = $2 WHERE id = $1`,
      [h.id, out],
    );
    await db.query(
      `UPDATE hospitalization_orders SET starts_at = starts_at + ${shift} - interval '48 hours', created_at = created_at + ${shift} - interval '48 hours', stopped_at = $2 WHERE hospitalization_id = $1`,
      [h.id, out],
    );
    await db.query(
      `UPDATE visits SET opened_at = $2::timestamptz - interval '50 hours', closed_at = $2 WHERE id = $1`,
      [h.visitId, out],
    );
    await db.query(`UPDATE charges SET created_at = $2 WHERE visit_id = $1`, [
      h.visitId,
      out,
    ]);
  }
}

/**
 * Al refrescar, la hoja de los internados se trae al momento actual: todas sus horas se corren
 * lo que pasó desde que se generó (así siguen "tocando" las mismas dosis).
 */
async function alignHospitalization(days) {
  const { rows } = await db.query(
    `SELECT extract(epoch FROM now() - max(updated_at)) * 1000 - $2 * 86400000 AS ms FROM hospitalizations WHERE clinic_id = $1 AND status = 'ACTIVE'`,
    [clinicId, days],
  );
  // En cuartos de hora: las horas de la hoja siguen siendo redondas
  const ms = Math.round(Number(rows[0]?.ms ?? 0) / 900_000) * 900_000;
  if (!ms) return;
  const by = `interval '1 millisecond' * ${Math.round(ms)}`;
  const active = `SELECT id FROM hospitalizations WHERE clinic_id = ${Number(clinicId)} AND status = 'ACTIVE'`;
  await db.query(
    `UPDATE hospitalization_orders SET starts_at = starts_at + ${by}, ends_at = ends_at + ${by}, created_at = created_at + ${by} WHERE hospitalization_id IN (${active})`,
  );
  await db.query(
    `UPDATE hospitalization_entries SET at = at + ${by}, scheduled_at = scheduled_at + ${by} WHERE hospitalization_id IN (${active})`,
  );
  await db.query(
    `UPDATE hospitalizations SET admitted_at = admitted_at + ${by}, updated_at = now() WHERE id IN (${active})`,
  );
  await db.query(
    `UPDATE visits v SET opened_at = h.admitted_at FROM hospitalizations h WHERE h.visit_id = v.id AND h.id IN (${active})`,
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
      d <= 5
        ? { day: d, open: '08:30', close: '20:00' }
        : d === 6
          ? { day: d, open: '09:00', close: '16:00' }
          : { day: d, open: '09:00', close: '13:00' },
    ),
  });
  // Boletas y facturas en simulación: se numeran e imprimen, sin ir a SUNAT.
  // Esa pantalla solo la cambia soporte técnico: el dueño de la demo lo es solo durante esta llamada.
  const granted = await db.query(
    'UPDATE users SET is_support = true WHERE lower(email) = lower($1) AND NOT is_support RETURNING id',
    [owner.email],
  );
  try {
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
  } finally {
    if (granted.rowCount)
      await db.query('UPDATE users SET is_support = false WHERE id = $1', [
        granted.rows[0].id,
      ]);
  }

  // ── Equipo: cada persona entra con DEMO_PASSWORD ──
  step('Equipo de la clínica');
  const team = {};
  const prefix = adminEmailDomain === DOMAIN ? '' : 'demo.';
  for (const [key, member] of Object.entries({
    vet: {
      fullName: 'Dra. Lucía Ruiz Paredes',
      role: 'VET',
      licenseNumber: '08451',
    },
    vet2: {
      fullName: 'Dr. Carlos Mendoza Ríos',
      role: 'VET',
      licenseNumber: '11287',
    },
    reception: { fullName: 'Carmen Huamán Soto', role: 'RECEPTION' },
    cashier: { fullName: 'Jorge Quispe Rojas', role: 'CASHIER' },
    groomer: { fullName: 'Rosa Flores Medina', role: 'GROOMER' },
    groomer2: { fullName: 'Kevin Torres Ccori', role: 'GROOMER' },
  })) {
    const email = `${prefix}${key}@${adminEmailDomain}`;
    const { data } = await call(admin, 'POST', '/users', { ...member, email });
    const first = await login(email, data.temporaryPassword);
    const changed = await call(first.cookie, 'PATCH', '/auth/password', {
      currentPassword: data.temporaryPassword,
      newPassword: DEMO_PASSWORD,
    });
    team[key] = {
      id: data.user.id,
      email,
      cookie: sessionCookie(changed.res),
      name: member.fullName,
    };
  }
  const { vet, vet2, reception, cashier, groomer, groomer2 } = team;
  // Una practicante que trabajó unos meses: su acceso se desactiva al final (Actividad → Accesos)
  const intern =
    DAYS > 60
      ? (
          await call(admin, 'POST', '/users', {
            fullName: 'Diana Paredes Lazo',
            role: 'RECEPTION',
            email: `${prefix}practicante@${adminEmailDomain}`,
          })
        ).data.user
      : null;
  const vets = [vet, vet2];
  const groomers = [groomer, groomer2];

  // ── Inventario: compras de hace dos meses ──
  step('Inventario y compras');
  const products = {};
  // Proveedores con RUC (el dígito verificador se calcula: módulo 11 de SUNAT)
  const ruc = (base) => {
    const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
    const sum = [...base].reduce((acc, d, i) => acc + Number(d) * w[i], 0);
    return base + ((11 - (sum % 11)) % 10);
  };
  const SUPPLIERS = {
    'Droguería Andina S.A.C.': {
      ruc: ruc('2050847261'),
      contact: 'Luis Rojas (vendedor)',
      phone: '987654321',
      notes: 'Visita los martes. Medicamentos y vacunas.',
    },
    'Agrovet del Centro E.I.R.L.': {
      ruc: ruc('2060193847'),
      contact: 'Carmen Huamán',
      phone: '945112387',
      notes: 'Antiparasitarios y pipetas.',
    },
    'Distribuidora PetFood S.A.C.': {
      ruc: ruc('2054419027'),
      contact: 'Pedidos',
      phone: '014562200',
      notes: 'Alimento balanceado y snacks. Entrega en 48 h.',
    },
    'Accesorios Lima S.A.C.': {
      ruc: ruc('2061187340'),
      contact: 'Jorge Paredes',
      phone: '956784120',
      notes: null,
    },
  };
  const supplierIds = {};
  const supplierId = async (name) => {
    if (!supplierIds[name]) {
      const { data } = await call(vet.cookie, 'POST', '/inventory/suppliers', {
        name,
        ...SUPPLIERS[name],
      });
      supplierIds[name] = data.id;
    }
    return supplierIds[name];
  };
  /** Las líneas se juntan por ficha (proveedor + número) y entran todas juntas */
  const pending = new Map();
  const flushPurchases = async () => {
    for (const ficha of pending.values())
      await call(vet.cookie, 'POST', '/inventory/purchases', {
        supplierId: await supplierId(ficha.supplier),
        docType: 'FACTURA',
        docNumber: ficha.document,
        issuedAt: today,
        pricesIncludeIgv: false,
        lines: ficha.lines,
      });
    pending.clear();
  };
  let restocking = false; // compras de reposición: solo lo que se usó
  const buy = async (key, product, purchase) => {
    let id = products[key]?.id;
    if (!id) {
      const { data } = await call(
        vet.cookie,
        'POST',
        '/inventory/products',
        product,
      );
      id = data.id;
      products[key] = {
        id,
        sale: data.presentations.at(-1).id,
        presentations: data.presentations,
      };
    }
    const presentation =
      products[key].presentations.find((p) => p.factor === purchase.factor) ??
      products[key].presentations[0];
    let quantity = purchase.quantity;
    const units = quantity * Number(presentation.factor ?? 1);
    // La primera compra marca el stock normal; después solo se repone lo que se fue usando
    products[key].target ??= units;
    if (restocking) {
      const { rows } = await db.query(
        `SELECT coalesce(sum(quantity), 0)::float AS stock FROM product_batches WHERE product_id = $1`,
        [id],
      );
      const missing = products[key].target - rows[0].stock;
      if (missing < products[key].target * 0.4) return; // todavía alcanza
      quantity = Math.max(
        1,
        Math.ceil(missing / Number(presentation.factor ?? 1)),
      );
    }
    const supplier = purchase.supplier ?? 'Droguería Andina S.A.C.';
    const keyOf = `${supplier}|${purchase.document}`;
    if (!pending.has(keyOf))
      pending.set(keyOf, { supplier, document: purchase.document, lines: [] });
    pending.get(keyOf).lines.push({
      productId: id,
      presentationId: presentation.id,
      quantity,
      unitPrice: purchase.cost,
      lotNumber: purchase.lot,
      expiresAt: purchase.expiresAt,
    });
  };
  const CATALOG = {
    sextuple: {
      name: 'Vacuna séxtuple canina',
      category: 'VACCINE',
      baseUnit: 'UNIT',
      minStock: 8,
      presentations: [{ name: 'Dosis', factor: 1, price: 60 }],
    },
    triple: {
      name: 'Vacuna triple felina',
      category: 'VACCINE',
      baseUnit: 'UNIT',
      minStock: 5,
      presentations: [{ name: 'Dosis', factor: 1, price: 55 }],
    },
    rabia: {
      name: 'Vacuna antirrábica',
      category: 'VACCINE',
      baseUnit: 'UNIT',
      minStock: 8,
      presentations: [{ name: 'Dosis', factor: 1, price: 35 }],
    },
    antipulgas: {
      name: 'Antipulgas masticable 10-20 kg',
      category: 'ANTIPARASITIC',
      baseUnit: 'TABLET',
      minStock: 6,
      presentations: [{ name: 'Tableta', factor: 1, price: 85 }],
    },
    pipeta: {
      name: 'Pipeta antipulgas gato',
      category: 'ANTIPARASITIC',
      baseUnit: 'UNIT',
      minStock: 6,
      presentations: [{ name: 'Pipeta', factor: 1, price: 38 }],
    },
    desparasitante: {
      name: 'Desparasitante interno perro',
      category: 'ANTIPARASITIC',
      baseUnit: 'TABLET',
      minStock: 20,
      presentations: [
        { name: 'Caja x 10', factor: 10, price: 120 },
        { name: 'Tableta', factor: 1, price: 15 },
      ],
    },
    meloxicam: {
      name: 'Meloxicam 1 mg',
      category: 'MEDICINE',
      baseUnit: 'TABLET',
      minStock: 30,
      requiresPrescription: true,
      presentations: [
        { name: 'Caja x 100', factor: 100, price: 150 },
        { name: 'Blíster x 10', factor: 10, price: 18 },
        { name: 'Tableta', factor: 1, price: 2 },
      ],
    },
    amoxicilina: {
      name: 'Amoxicilina 250 mg',
      category: 'MEDICINE',
      baseUnit: 'TABLET',
      minStock: 20,
      requiresPrescription: true,
      presentations: [
        { name: 'Caja x 100', factor: 100, price: 160 },
        { name: 'Blíster x 10', factor: 10, price: 20 },
      ],
    },
    suero: {
      name: 'Cloruro de sodio 0.9 % 500 ml',
      category: 'SUPPLY',
      baseUnit: 'ML',
      minStock: 1500,
      presentations: [{ name: 'Frasco 500 ml', factor: 500, price: 18 }],
    },
    jeringa: {
      name: 'Jeringa 3 ml',
      category: 'SUPPLY',
      baseUnit: 'UNIT',
      minStock: 40,
      presentations: [
        { name: 'Caja x 100', factor: 100, price: 45 },
        { name: 'Unidad', factor: 1, price: 1 },
      ],
    },
    champu: {
      name: 'Champú clorhexidina',
      category: 'HYGIENE',
      baseUnit: 'ML',
      minStock: 500,
      presentations: [{ name: 'Frasco 500 ml', factor: 500, price: 38 }],
    },
    champuNormal: {
      name: 'Champú neutro grooming',
      category: 'HYGIENE',
      baseUnit: 'ML',
      minStock: 1000,
      presentations: [{ name: 'Galón 3.8 L', factor: 3800, price: 95 }],
    },
    alimento: {
      name: 'Alimento balanceado adulto 3 kg',
      category: 'FOOD',
      baseUnit: 'UNIT',
      minStock: 4,
      presentations: [{ name: 'Bolsa 3 kg', factor: 1, price: 89 }],
    },
    alimentoGato: {
      name: 'Alimento gato adulto 1.5 kg',
      category: 'FOOD',
      baseUnit: 'UNIT',
      minStock: 4,
      presentations: [{ name: 'Bolsa 1.5 kg', factor: 1, price: 52 }],
    },
    snack: {
      name: 'Snack dental perro',
      category: 'FOOD',
      baseUnit: 'UNIT',
      minStock: 10,
      presentations: [{ name: 'Unidad', factor: 1, price: 6 }],
    },
    collar: {
      name: 'Collar isabelino talla M',
      category: 'ACCESSORY',
      baseUnit: 'UNIT',
      minStock: 6,
      presentations: [{ name: 'Unidad', factor: 1, price: 25 }],
    },
    guantes: {
      name: 'Guantes de examen talla M',
      category: 'SUPPLY',
      baseUnit: 'UNIT',
      minStock: 100,
      presentations: [{ name: 'Caja x 100', factor: 100, price: 35 }],
    },
    tubo: {
      name: 'Tubo EDTA 2 ml',
      category: 'SUPPLY',
      baseUnit: 'UNIT',
      minStock: 20,
      presentations: [{ name: 'Caja x 100', factor: 100, price: 110 }],
    },
    correa: {
      name: 'Correa retráctil 5 m',
      category: 'ACCESSORY',
      baseUnit: 'UNIT',
      minStock: 0,
      presentations: [{ name: 'Unidad', factor: 1, price: 69 }],
    },
    cama: {
      name: 'Cama ortopédica para perro talla M',
      category: 'ACCESSORY',
      baseUnit: 'UNIT',
      minStock: 2,
      presentations: [{ name: 'Unidad', factor: 1, price: 149 }],
    },
    juguete: {
      name: 'Juguete mordedor de caucho',
      category: 'ACCESSORY',
      baseUnit: 'UNIT',
      minStock: 5,
      presentations: [{ name: 'Unidad', factor: 1, price: 29 }],
    },
  };
  const purchases = async (offset, factor = 1) => {
    const n = (q) => Math.max(1, Math.round(q * factor));
    await buy('sextuple', CATALOG.sextuple, {
      factor: 1,
      quantity: n(40),
      lot: `VS-${2600 + offset * -1}`,
      expiresAt: day(240),
      cost: 28,
      document: `F001-${1200 - offset * 10}`,
    });
    await buy('triple', CATALOG.triple, {
      factor: 1,
      quantity: n(20),
      lot: `TF-${900 - offset}`,
      expiresAt: day(180),
      cost: 26,
      document: `F001-${1200 - offset * 10}`,
    });
    await buy('rabia', CATALOG.rabia, {
      factor: 1,
      quantity: n(30),
      lot: `AR-${300 - offset}`,
      expiresAt: day(300),
      cost: 12,
      document: `F001-${1200 - offset * 10}`,
    });
    await buy('antipulgas', CATALOG.antipulgas, {
      factor: 1,
      quantity: n(60),
      lot: `AP-${7700 - offset}`,
      expiresAt: day(420),
      cost: 55,
      document: `F001-${1201 - offset * 10}`,
      supplier: 'Agrovet del Centro E.I.R.L.',
    });
    await buy('pipeta', CATALOG.pipeta, {
      factor: 1,
      quantity: n(40),
      lot: `PG-${500 - offset}`,
      expiresAt: day(380),
      cost: 22,
      document: `F001-${1201 - offset * 10}`,
      supplier: 'Agrovet del Centro E.I.R.L.',
    });
    await buy('desparasitante', CATALOG.desparasitante, {
      factor: 10,
      quantity: n(8),
      lot: `DP-${110 - offset}`,
      expiresAt: day(500),
      cost: 70,
      document: `F001-${1201 - offset * 10}`,
    });
    await buy('amoxicilina', CATALOG.amoxicilina, {
      factor: 100,
      quantity: n(2),
      lot: `AX-${40 - offset}`,
      expiresAt: day(400),
      cost: 90,
      document: `F001-${1202 - offset * 10}`,
    });
    await buy('suero', CATALOG.suero, {
      factor: 500,
      quantity: n(16),
      lot: `SF-${70 - offset}`,
      expiresAt: day(600),
      cost: 7,
      document: `F001-${1202 - offset * 10}`,
    });
    await buy('jeringa', CATALOG.jeringa, {
      factor: 100,
      quantity: n(3),
      lot: `JR-${60 - offset}`,
      expiresAt: day(900),
      cost: 18,
      document: `F001-${1202 - offset * 10}`,
    });
    await buy('champu', CATALOG.champu, {
      factor: 500,
      quantity: n(6),
      lot: `CH-${118 - offset}`,
      expiresAt: day(330),
      cost: 21,
      document: `F001-${1203 - offset * 10}`,
    });
    await buy('champuNormal', CATALOG.champuNormal, {
      factor: 3800,
      quantity: n(3),
      lot: `CN-${20 - offset}`,
      expiresAt: day(500),
      cost: 55,
      document: `F001-${1203 - offset * 10}`,
    });
    await buy('alimento', CATALOG.alimento, {
      factor: 1,
      quantity: n(30),
      lot: `AB-${5530 - offset}`,
      expiresAt: day(240),
      cost: 58,
      document: `F001-${1204 - offset * 10}`,
      supplier: 'Distribuidora PetFood S.A.C.',
    });
    await buy('alimentoGato', CATALOG.alimentoGato, {
      factor: 1,
      quantity: n(20),
      lot: `AG-${880 - offset}`,
      expiresAt: day(260),
      cost: 33,
      document: `F001-${1204 - offset * 10}`,
      supplier: 'Distribuidora PetFood S.A.C.',
    });
    await buy('guantes', CATALOG.guantes, {
      factor: 100,
      quantity: n(6),
      lot: `GE-${300 - offset}`,
      expiresAt: day(900),
      cost: 22,
      document: `F001-${1202 - offset * 10}`,
    });
    await buy('tubo', CATALOG.tubo, {
      factor: 100,
      quantity: n(1),
      lot: `TE-${80 - offset}`,
      expiresAt: day(700),
      cost: 70,
      document: `F001-${1202 - offset * 10}`,
    });
    await buy('meloxicam', CATALOG.meloxicam, {
      factor: 100,
      quantity: n(2),
      lot: `MX-${2700 - offset}`,
      expiresAt: day(400),
      cost: 85,
      document: `F001-${1202 - offset * 10}`,
    });
    await buy('snack', CATALOG.snack, {
      factor: 1,
      quantity: n(150),
      lot: `SN-${45 - offset}`,
      expiresAt: day(200),
      cost: 2.5,
      document: `F001-${1204 - offset * 10}`,
      supplier: 'Distribuidora PetFood S.A.C.',
    });
  };
  let block = await snapshot();
  await purchases(-DAYS - 2);
  // Meloxicam que vence pronto y collar con poco stock: se ven en las alertas
  await buy('meloxicam', CATALOG.meloxicam, {
    factor: 100,
    quantity: 2,
    lot: 'MX-2611',
    expiresAt: day(24),
    cost: 85,
    document: 'F001-1188',
  });
  await buy('collar', CATALOG.collar, {
    factor: 1,
    quantity: 4,
    lot: null,
    expiresAt: null,
    cost: 9,
    document: 'F001-1188',
    supplier: 'Accesorios Lima S.A.C.',
  });
  // Camas y juguetes no vencen: la compra va sin lote ni fecha
  await buy('cama', CATALOG.cama, {
    factor: 1,
    quantity: 5,
    lot: null,
    expiresAt: null,
    cost: 78,
    document: 'F001-1188',
    supplier: 'Accesorios Lima S.A.C.',
  });
  await buy('juguete', CATALOG.juguete, {
    factor: 1,
    quantity: 24,
    lot: null,
    expiresAt: null,
    cost: 11,
    document: 'F001-1188',
    supplier: 'Accesorios Lima S.A.C.',
  });
  // Un controlado (DIGEMID): entra con lote y su factura, y cada uso queda en el libro
  await buy(
    'ketamina',
    {
      name: 'Ketamina 50 mg/ml',
      category: 'MEDICINE',
      baseUnit: 'ML',
      minStock: 20,
      controlled: true,
      requiresPrescription: true,
      presentations: [{ name: 'Frasco x 10 ml', factor: 10, price: 95 }],
    },
    {
      factor: 10,
      quantity: 3,
      lot: 'KT-2410',
      expiresAt: day(400),
      cost: 62,
      document: 'F001-1188',
    },
  );
  await flushPurchases();
  await shiftTo(block, day(-DAYS - 2), '10:00', '11:30');
  // Correas que se compraron hace casi tres meses y no se venden: "sin movimiento" en Reportes
  block = await snapshot();
  await buy('correa', CATALOG.correa, {
    factor: 1,
    quantity: 6,
    lot: null,
    expiresAt: null,
    cost: 32,
    document: 'F001-1102',
    supplier: 'Accesorios Lima S.A.C.',
  });
  // Un lote de antirrábica que se dejó vencer: valor en riesgo y aviso en el inventario
  await buy('rabia', CATALOG.rabia, {
    factor: 1,
    quantity: 4,
    lot: 'AR-0915',
    expiresAt: day(30),
    cost: 12,
    document: 'F001-1102',
  });
  await flushPurchases();
  await shiftTo(block, day(-82), '16:00', '16:20');
  await db.query(
    `UPDATE product_batches SET expires_at = $2 WHERE clinic_id = $1 AND lot_number = 'AR-0915'`,
    [clinicId, day(-6)],
  );

  // ── Servicios ──
  step('Servicios y precios');
  const services = {};
  for (const [key, s] of Object.entries({
    consulta: {
      name: 'Consulta general',
      category: 'CONSULTATION',
      price: 50,
      durationMin: 30,
      supplies: [{ productId: products.guantes.id, quantity: 2 }],
    },
    control: {
      name: 'Control (reconsulta)',
      category: 'CONSULTATION',
      price: 30,
      durationMin: 20,
      supplies: [{ productId: products.guantes.id, quantity: 2 }],
    },
    emergencia: {
      name: 'Consulta de emergencia',
      category: 'CONSULTATION',
      price: 90,
      durationMin: 45,
      supplies: [
        { productId: products.guantes.id, quantity: 4 },
        { productId: products.jeringa.id, quantity: 1 },
      ],
    },
    sextuple: {
      name: 'Vacunación séxtuple canina',
      category: 'VACCINATION',
      price: 75,
      durationMin: 15,
      supplies: [
        { productId: products.sextuple.id, quantity: 1 },
        { productId: products.jeringa.id, quantity: 1 },
      ],
    },
    triple: {
      name: 'Vacunación triple felina',
      category: 'VACCINATION',
      price: 70,
      durationMin: 15,
      supplies: [
        { productId: products.triple.id, quantity: 1 },
        { productId: products.jeringa.id, quantity: 1 },
      ],
    },
    rabia: {
      name: 'Vacunación antirrábica',
      category: 'VACCINATION',
      price: 45,
      durationMin: 10,
      supplies: [
        { productId: products.rabia.id, quantity: 1 },
        { productId: products.jeringa.id, quantity: 1 },
      ],
    },
    desparasitacion: {
      name: 'Desparasitación interna',
      category: 'DEWORMING',
      price: 25,
      durationMin: 10,
      supplies: [{ productId: products.desparasitante.id, quantity: 1 }],
    },
    fluidos: {
      name: 'Fluidoterapia subcutánea',
      category: 'OTHER',
      price: 40,
      durationMin: 20,
      supplies: [{ productId: products.suero.id, quantity: 250 }],
    },
    hemograma: {
      name: 'Hemograma completo',
      category: 'LAB',
      price: 65,
      durationMin: 15,
      supplies: [
        { productId: products.tubo.id, quantity: 1 },
        { productId: products.jeringa.id, quantity: 1 },
        { productId: products.guantes.id, quantity: 2 },
      ],
    },
    bioquimico: {
      name: 'Perfil bioquímico',
      category: 'LAB',
      price: 90,
      durationMin: 15,
    },
    copro: {
      name: 'Coproparasitológico',
      category: 'LAB',
      price: 30,
      durationMin: 10,
    },
    ecografia: {
      name: 'Ecografía abdominal',
      category: 'LAB',
      price: 120,
      durationMin: 30,
    },
    castracion: {
      name: 'Castración canina',
      category: 'SURGERY',
      price: 350,
      durationMin: 90,
      supplies: [
        { productId: products.suero.id, quantity: 500 },
        { productId: products.jeringa.id, quantity: 3 },
        { productId: products.guantes.id, quantity: 6 },
      ],
    },
    profilaxis: {
      name: 'Profilaxis dental',
      category: 'SURGERY',
      price: 220,
      durationMin: 60,
      supplies: [
        { productId: products.guantes.id, quantity: 4 },
        { productId: products.jeringa.id, quantity: 2 },
      ],
    },
    bano: {
      name: 'Baño completo',
      category: 'GROOMING',
      price: 35,
      durationMin: 60,
      supplies: [{ productId: products.champuNormal.id, quantity: 60 }],
      sizePrices: [
        { size: 'MEDIUM', price: 45 },
        { size: 'LARGE', price: 60 },
        { size: 'GIANT', price: 80 },
      ],
    },
    banoMedicado: {
      name: 'Baño medicado',
      category: 'GROOMING',
      price: 45,
      durationMin: 60,
      supplies: [{ productId: products.champu.id, quantity: 40 }],
      sizePrices: [
        { size: 'MEDIUM', price: 55 },
        { size: 'LARGE', price: 70 },
        { size: 'GIANT', price: 90 },
      ],
    },
    corte: {
      name: 'Corte de pelo',
      category: 'GROOMING',
      price: 30,
      durationMin: 60,
      supplies: [{ productId: products.champuNormal.id, quantity: 20 }],
      sizePrices: [
        { size: 'MEDIUM', price: 40 },
        { size: 'LARGE', price: 55 },
        { size: 'GIANT', price: 70 },
      ],
    },
    unas: {
      name: 'Corte de uñas',
      category: 'GROOMING',
      price: 10,
      durationMin: 15,
    },
    oidos: {
      name: 'Limpieza de oídos',
      category: 'GROOMING',
      price: 12,
      durationMin: 10,
    },
    hospitalizacion: {
      name: 'Hospitalización (día)',
      category: 'HOSPITALIZATION',
      price: 120,
    },
  })) {
    services[key] = (await call(admin, 'POST', '/care-services', s)).data.id;
  }

  step('Plantillas de consulta y recetas frecuentes');
  await seedTemplates(vet.cookie, products);

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
      email: chance(0.4)
        ? `${p.name.split(' ')[0].toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')}.${between(10, 99)}@gmail.com`
        : null,
      address: `${pick(STREETS)} ${between(100, 999)}`,
      district: pick(DISTRICTS),
      consent: true,
      marketingConsent: chance(0.35),
      pet,
    });
    const entry = {
      id: data.pets[0].id,
      name: pet.name,
      species: pet.species,
      weightKg: pet.weightKg,
      clientId: data.id,
      owner: p.name,
      visits: 0,
    };
    pets.push(entry);
    if (chance(0.15)) {
      const second = newPet(usedPetNames);
      const extra = await call(
        reception.cookie,
        'POST',
        `/clients/${data.id}/pets`,
        second,
      );
      pets.push({
        id: extra.data.id,
        name: second.name,
        species: second.species,
        weightKg: second.weightKg,
        clientId: data.id,
        owner: p.name,
        visits: 0,
      });
    }
    if (chance(0.2))
      await call(reception.cookie, 'POST', `/clients/${data.id}/authorized`, {
        name: `${pick(FIRST_F.concat(FIRST_M))} ${p.name.split(' ')[1]}`,
        dni: String(dniBase++),
        phone: phone(),
        relation: pick(['Hijo(a)', 'Esposo(a)', 'Hermano(a)']),
      }).catch(() => undefined);
    return entry;
  };

  step('Clientes que ya venían');
  block = await snapshot();
  usedPetNames.add('Manchas'); // la mascota del albergue: que ninguna otra se llame igual
  const company = await newClient({
    person: { name: 'Albergue Patitas Felices S.A.C.' },
    ruc: COMPANY_RUC,
    pet: {
      name: 'Manchas',
      species: 'DOG',
      breed: 'Mestizo',
      sex: 'MALE',
      birthDate: yearsAgo(3),
      weightKg: 16,
    },
  });
  for (let i = 0; i < 26; i++) await newClient();
  await shiftTo(block, day(-DAYS - 1));

  // ── Ayudas del día ──
  const opened = { sessionId: null };
  const pickPet = (filter = () => true) => {
    const list = pets.filter(filter);
    return list[Math.floor(rand() * list.length)];
  };
  const sizeOf = (p) =>
    !p.weightKg || p.weightKg <= 10
      ? 'SMALL'
      : p.weightKg <= 25
        ? 'MEDIUM'
        : p.weightKg <= 40
          ? 'LARGE'
          : 'GIANT';
  const payMethod = () => {
    const r = rand();
    return r < 0.42
      ? 'CASH'
      : r < 0.67
        ? 'YAPE'
        : r < 0.77
          ? 'PLIN'
          : r < 0.93
            ? 'CARD'
            : 'TRANSFER';
  };
  const collectClient = async (clientId, { partial = false } = {}) => {
    const ruc = clientId === company.clientId;
    const account = (
      await call(cashier.cookie, 'GET', `/clients/${clientId}/account`)
    ).data;
    let amount = account.pendingTotal;
    if (amount <= 0) return;
    if (partial) amount = Math.max(10, Math.round(amount / 2));
    const method = payMethod();
    const tendered =
      method === 'CASH'
        ? Math.ceil(amount / 10) * 10 + (chance(0.4) ? 10 : 0)
        : null;
    const res = await call(cashier.cookie, 'POST', '/cash/receipts', {
      requestKey: randomUUID(),
      clientId,
      amount,
      payments: [
        {
          method,
          amount,
          tendered,
          operationCode:
            method === 'CASH' ? null : String(between(100000, 999999)),
        },
      ],
      // Toda venta lleva su comprobante: factura a la empresa con RUC, boleta a los demás
      document: ruc ? 'FACTURA' : 'BOLETA',
    });
    lastReceipt = { id: res.data.receipt?.id ?? res.data.id, clientId };
    return lastReceipt;
  };
  let lastReceipt = null;
  const openCash = async () => {
    const { data } = await call(cashier.cookie, 'POST', '/cash/sessions', {
      openingAmount: pick([100, 150, 200]),
    });
    opened.sessionId = data.id;
  };
  const closeCash = async () => {
    const current = (
      await call(cashier.cookie, 'GET', '/cash/sessions/current')
    ).data;
    if (!current) return;
    const off = chance(0.12) ? -pick([0.5, 1, 2]) : 0;
    await call(cashier.cookie, 'POST', `/cash/sessions/${current.id}/close`, {
      countedCash: Math.round((current.expectedCash + off) * 100) / 100,
      note: off ? 'Faltó sencillo para un vuelto' : null,
    });
  };

  /** Una consulta completa: cola (o cita), SOAP, cargos, vacuna, receta y cierre */
  /**
   * Exámenes del caso: hemograma en la clínica y, a veces, bioquímico a un laboratorio externo.
   * Avanzan según `labStage`: los de días pasados quedan revisados; los de ayer y anteayer, en
   * proceso o con resultado por revisar (así Exámenes e Inicio tienen trabajo).
   */
  let labStage = 'REVIEWED';
  const LAB_STEPS = ['REQUESTED', 'SAMPLE_TAKEN', 'RESULT_READY', 'REVIEWED'];
  const labWork = async (doctor, visitId) => {
    const orders = [
      (
        await call(doctor.cookie, 'POST', `/visits/${visitId}/lab-orders`, {
          careServiceIds: [services.hemograma],
          destination: 'IN_HOUSE',
          indication: 'Descartar anemia e infección',
          charge: true,
        })
      ).data,
    ];
    if (chance(0.4))
      orders.push(
        (
          await call(doctor.cookie, 'POST', `/visits/${visitId}/lab-orders`, {
            careServiceIds: [services.bioquimico],
            destination: 'EXTERNAL',
            externalLab: 'Laboratorio Central Chosica',
            labCost: 55,
            indication: 'Función renal y hepática',
            charge: true,
          })
        ).data,
      );
    const upTo = LAB_STEPS.indexOf(labStage);
    for (const o of orders) {
      if (upTo >= 1)
        await call(doctor.cookie, 'POST', `/lab-orders/${o.id}/sample`);
      if (upTo >= 2) {
        const form = new FormData();
        form.append(
          'resultText',
          o.destination === 'EXTERNAL'
            ? 'Urea 38 mg/dL · Creatinina 1.1 mg/dL · ALT 52 U/L · Glucosa 96 mg/dL'
            : 'Hto 41 % · Hb 14.2 g/dL · Leucocitos 13 800/µL · Plaquetas 310 000/µL',
        );
        await call(doctor.cookie, 'POST', `/lab-orders/${o.id}/result`, form);
      }
      if (upTo >= 3)
        await call(doctor.cookie, 'POST', `/lab-orders/${o.id}/review`, {
          interpretation: 'Valores dentro del rango normal para la edad.',
        });
    }
  };

  const consult = async (
    pet,
    { appointmentEntry, closeIt = true, urgent = false, forcedCase } = {},
  ) => {
    const c =
      forcedCase ??
      pick(
        CASES.filter(
          (x) =>
            !(x.vaccine || x.deworm) || ['DOG', 'CAT'].includes(pet.species),
        ),
      );
    const doctor = pick(vets);
    let withMove = false;
    const entry =
      appointmentEntry ??
      (
        await call(reception.cookie, 'POST', '/queue', {
          petId: pet.id,
          urgent,
          reason: c.reason,
          // Algunos dueños piden que lo recojan y lo devuelvan
          ...((withMove = closeIt && !urgent && chance(0.05))
            ? {
                transport: 'ROUND_TRIP',
                transportAddress: `${pick(STREETS)} ${between(100, 999)}, ${pick(DISTRICTS)}`,
                transportPrice: pick([15, 20, 25]),
              }
            : {}),
        })
      ).data.id;
    const visit = (
      await call(doctor.cookie, 'POST', '/visits', {
        petId: pet.id,
        queueEntryId: entry,
      })
    ).data;
    // Dos decimales: un periquito pesa 0.05 kg y no debe redondearse a 0
    const weight = pet.weightKg
      ? Math.max(
          0.05,
          Math.round(pet.weightKg * (0.97 + rand() * 0.06) * 100) / 100,
        )
      : null;
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
      items.push({
        careServiceId:
          pet.species === 'CAT'
            ? services.triple
            : chance(0.5)
              ? services.sextuple
              : services.rabia,
        quantity: 1,
      });
    } else if (c.deworm) {
      items.push({ careServiceId: services.desparasitacion, quantity: 1 });
    } else {
      items.push({
        careServiceId:
          pet.visits > 0 && chance(0.4)
            ? services.control
            : urgent
              ? services.emergencia
              : services.consulta,
        quantity: 1,
      });
    }
    if (c.fluids) items.push({ careServiceId: services.fluidos, quantity: 1 });
    if (c.antipulgas)
      items.push({
        productId:
          pet.species === 'CAT' ? products.pipeta.id : products.antipulgas.id,
        presentationId:
          pet.species === 'CAT'
            ? products.pipeta.sale
            : products.antipulgas.sale,
        quantity: 1,
      });
    if (chance(0.15))
      items.push({
        productId: products.snack.id,
        presentationId: products.snack.sale,
        quantity: between(1, 3),
      });
    // A veces un descuento con su motivo (el tope de la clínica es 10 %): sale en Reportes · Control
    if (chance(0.12))
      Object.assign(items[0], {
        discount: pick([2, 3, 4]),
        discountReason: pick([
          'Cliente frecuente',
          'Cliente frecuente',
          'Albergue',
          'Promoción del mes',
        ]),
      });
    // Si un producto se acabó, se cobra solo el servicio (como en la vida real)
    await call(doctor.cookie, 'POST', '/charges', {
      visitId: visit.id,
      items,
    }).catch(() =>
      call(doctor.cookie, 'POST', '/charges', {
        visitId: visit.id,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        items: items
          .filter((i) => i.careServiceId)
          .map(({ discount, discountReason, ...i }) => i),
      }),
    );
    if (c.lab) await labWork(doctor, visit.id);
    if (c.vaccine)
      await call(doctor.cookie, 'POST', '/immunizations', {
        petId: pet.id,
        visitId: visit.id,
        kind: 'VACCINE',
        name:
          pet.species === 'CAT'
            ? 'Triple felina'
            : items[0].careServiceId === services.rabia
              ? 'Antirrábica'
              : 'Séxtuple',
        laboratory: pick(['Zoetis', 'MSD', 'Boehringer']),
        batchNumber: pick(['VS-2611', 'TF-0931', 'AR-301']),
        nextDueAt: day(365),
      });
    if (c.deworm)
      await call(doctor.cookie, 'POST', '/immunizations', {
        petId: pet.id,
        visitId: visit.id,
        kind: 'DEWORMING_INTERNAL',
        name: 'Desparasitante interno',
        nextDueAt: day(90),
      });
    if (c.antipulgas)
      await call(doctor.cookie, 'POST', '/immunizations', {
        petId: pet.id,
        visitId: visit.id,
        kind: 'DEWORMING_EXTERNAL',
        name:
          pet.species === 'CAT' ? 'Pipeta antipulgas' : 'Antipulgas masticable',
        nextDueAt: day(pet.species === 'CAT' ? 30 : 90),
      });
    if (c.rx)
      await call(doctor.cookie, 'POST', `/visits/${visit.id}/prescriptions`, {
        notes: c.plan,
        items: [
          {
            drug: c.rx[0],
            dose: c.rx[1],
            route: 'Oral',
            frequency: c.rx[2],
            duration: c.rx[3],
            instructions: 'Dar con comida',
          },
        ],
      });
    if (c.meloxicam)
      await call(doctor.cookie, 'POST', `/visits/${visit.id}/prescriptions`, {
        notes: 'Reposo y control en 7 días.',
        items: [
          {
            productId: products.meloxicam.id,
            presentationId: products.meloxicam.presentations.find(
              (p) => p.factor === 1,
            ).id,
            drug: 'Meloxicam 1 mg',
            dose: '1 tableta',
            route: 'Oral',
            frequency: 'Cada 24 horas',
            duration: '5 días',
            dispenseQuantity: 5,
          },
        ],
      }).catch(() =>
        // Sin stock: la receta sale igual, para comprar afuera
        call(doctor.cookie, 'POST', `/visits/${visit.id}/prescriptions`, {
          notes: 'Reposo y control en 7 días.',
          items: [
            {
              drug: 'Meloxicam 1 mg',
              dose: '1 tableta',
              route: 'Oral',
              frequency: 'Cada 24 horas',
              duration: '5 días',
            },
          ],
        }),
      );
    pet.visits++;
    if (weight) pet.weightKg = weight;
    if (closeIt) {
      await call(doctor.cookie, 'POST', `/visits/${visit.id}/close`);
      // Con movilidad: lo dejan en su casa
      if (withMove)
        await call(
          reception.cookie,
          'POST',
          `/queue/${entry}/delivered-home`,
        ).catch(() => undefined);
    }
    return visit.id;
  };

  /** Un servicio de grooming del ingreso a la entrega (o hasta `until`) */
  const groom = async (pet, { until = 'DELIVERED', queueEntryId } = {}) => {
    const size = sizeOf(pet);
    const chosen = pick([
      [services.bano],
      [services.bano, services.unas],
      [services.bano, services.corte],
      [services.bano, services.corte, services.unas, services.oidos],
      [services.banoMedicado],
      [services.unas],
    ]);
    // Movilidad con el precio que pone recepción (según la distancia)
    const transport = chance(0.15)
      ? pick(['ROUND_TRIP', 'ROUND_TRIP', 'PICKUP', 'DROPOFF'])
      : 'NONE';
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
      belongings: chance(0.4)
        ? pick([
            'Collar rojo',
            'Correa azul',
            'Pechera y correa',
            'Ropa de abrigo',
          ])
        : null,
      instructions: pick([
        null,
        'Corte cachorro',
        'Solo higiénico',
        'Sin perfume',
        'Dejar las orejas largas',
        'Corte corto por el calor',
        'Moño rosado',
      ]),
      transport,
      transportAddress:
        transport === 'NONE'
          ? null
          : `${pick(STREETS)} ${between(100, 999)}, ${pick(DISTRICTS)}`,
      transportPrice:
        transport === 'NONE'
          ? null
          : transport === 'ROUND_TRIP'
            ? pick([15, 18, 20, 25])
            : pick([8, 10, 12]),
      signerName: chance(0.5) ? pet.owner : null,
      signature: null,
    });
    const order = ['BATHING', 'CUTTING', 'READY'];
    const onlyNails = chosen.length === 1 && chosen[0] === services.unas;
    for (const status of onlyNails
      ? ['READY']
      : chosen.includes(services.corte)
        ? order
        : ['BATHING', 'READY']) {
      if (until === 'WAITING') break;
      await call(g.cookie, 'PATCH', `/grooming/${data.id}/status`, { status });
      if (status === until) break;
    }
    if (until !== 'DELIVERED') return data;
    if (chance(0.7))
      await call(reception.cookie, 'POST', `/grooming/${data.id}/notify`);
    await call(reception.cookie, 'POST', `/grooming/${data.id}/deliver`, {
      pickedUpBy: pet.owner,
      pickedUpRelation: 'Propietario(a)',
    });
    return data;
  };

  // ── Historia: un día de trabajo a la vez, luego se lleva a su fecha ──
  step(
    `Historia de ${DAYS} días (atenciones, cobros, cierres de caja, grooming)`,
  );
  const portalClients = new Set();
  for (let offset = -DAYS; offset < 0; offset++) {
    const d = day(offset);
    labStage =
      offset === -1
        ? 'SAMPLE_TAKEN'
        : offset === -2
          ? 'RESULT_READY'
          : 'REVIEWED';
    const wd = weekday(d);
    const sunday = wd === 0; // domingo: solo la mañana
    const saturday = wd === 6 || sunday;
    const busy = busyness(d, offset);
    block = await snapshot();
    await openCash();
    lastReceipt = null;
    // Clientes nuevos que llegan ese día
    for (let i = 0; i < (chance(0.6 * busy.consult) ? between(1, 2) : 0); i++)
      await newClient();
    // Consultas
    const consults = scaled(
      sunday ? between(0, 2) : saturday ? between(2, 4) : between(4, 7),
      busy.consult,
    );
    for (let i = 0; i < consults; i++) {
      const pet = pickPet(
        (p) => ['DOG', 'CAT'].includes(p.species) || chance(0.3),
      );
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
          entry = (
            await call(
              reception.cookie,
              'POST',
              `/appointments/${appt.id}/arrive`,
            )
          ).data.queueEntryId;
        } catch {
          entry = undefined; // ya tenía una cita a esa hora: llega sin cita
        }
      }
      await consult(pet, {
        appointmentEntry: entry,
        urgent: !entry && chance(0.08),
      });
      await collectClient(pet.clientId, { partial: chance(0.07) });
    }
    // Grooming
    const grooms = scaled(
      sunday ? between(0, 1) : saturday ? between(3, 5) : between(1, 3),
      busy.groom,
    );
    for (let i = 0; i < grooms; i++) {
      const pet = pickPet(
        (p) => p.species === 'DOG' || (p.species === 'CAT' && chance(0.2)),
      );
      await groom(pet);
      if (chance(0.92)) await collectClient(pet.clientId);
    }
    // Ventas de mostrador
    for (let i = 0; i < between(0, 2); i++) {
      const item = pick([
        'alimento',
        'alimentoGato',
        'snack',
        'antipulgas',
        'pipeta',
      ]);
      const method = payMethod();
      const price = {
        alimento: 89,
        alimentoGato: 52,
        snack: 6,
        antipulgas: 85,
        pipeta: 38,
      }[item];
      const qty = item === 'snack' ? between(2, 5) : 1;
      await call(cashier.cookie, 'POST', '/cash/counter-sales', {
        requestKey: randomUUID(),
        items: [
          {
            productId: products[item].id,
            presentationId: products[item].sale,
            quantity: qty,
          },
        ],
        payments: [
          {
            method,
            amount: price * qty,
            tendered:
              method === 'CASH' ? Math.ceil((price * qty) / 10) * 10 : null,
            operationCode:
              method === 'CASH' ? null : String(between(100000, 999999)),
          },
        ],
        document: 'BOLETA',
      }).catch(() => undefined); // sin stock: no hubo venta
    }
    if (chance(0.25))
      await call(cashier.cookie, 'POST', '/cash/expenses', {
        amount: pick([12, 15, 20, 35]),
        reason: pick([
          'Bidón de agua',
          'Útiles de limpieza',
          'Movilidad',
          'Bolsas y papel toalla',
        ]),
      });
    // Una cita que no vino
    if (chance(0.2)) {
      const p = pickPet();
      const appt = await call(reception.cookie, 'POST', '/appointments', {
        petId: p.id,
        vetId: pick(vets).id,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        durationMin: 30,
        type: 'CONSULTATION',
        reason: 'Control',
        allowOverlap: true,
      }).catch(() => null);
      if (appt)
        await call(
          reception.cookie,
          'POST',
          `/appointments/${appt.data.id}/no-show`,
        ).catch(() => undefined);
    }
    // Un cobro mal registrado: el administrador lo anula (sale la nota de crédito) y se vuelve a cobrar
    if (lastReceipt && -offset % 47 === 11) {
      await call(admin, 'POST', `/cash/receipts/${lastReceipt.id}/void`, {
        reason: pick([
          'Se cobró con el medio de pago equivocado',
          'Se registró al cliente equivocado',
          'Pidió factura y se emitió boleta',
        ]),
      });
      await collectClient(lastReceipt.clientId);
    }
    // Suben los precios: queda en Actividad (precios) y el ticket promedio sube en Reportes
    if (offset === -200 && DAYS > 210)
      await call(admin, 'PATCH', `/care-services/${services.unas}`, {
        price: 12,
      });
    if (offset === -120 && DAYS > 130)
      await call(admin, 'PATCH', `/care-services/${services.consulta}`, {
        price: 55,
      });
    // Terminó la práctica: se desactiva su acceso
    if (intern && offset === -45)
      await call(admin, 'PATCH', `/users/${intern.id}`, { active: false });
    // Algunos dueños reciben el enlace a su portal (vacunas, citas y recetas desde el celular)
    if (chance(0.12)) {
      const p = pickPet();
      if (!portalClients.has(p.clientId)) {
        portalClients.add(p.clientId);
        await call(reception.cookie, 'POST', `/clients/${p.clientId}/portal`);
      }
    }
    await closeCash();
    await shiftTo(
      block,
      d,
      saturday ? '09:05' : '08:40',
      sunday ? '12:45' : saturday ? '15:40' : '19:30',
    );
    // Compras de reposición cada tres semanas
    if (offset % 21 === 0) {
      block = await snapshot();
      restocking = true;
      await purchases(offset, 0.8);
      restocking = false;
      await flushPurchases();
      await shiftTo(block, d, '19:35', '19:50');
    }
    if (process.env.DEMO_DEBUG) console.log(d, stats.calls, stats.ms);
    process.stdout.write(`  ${d} listo\r`);
  }
  console.log('');

  // ── Lo que la clínica hace alrededor de las atenciones ──
  step('Avisos de refuerzo, portal del dueño, adenda y factura de compra');
  block = await snapshot();
  // Refuerzos que vencieron o vencen esta semana: a más de la mitad ya se les avisó por WhatsApp
  const { rows: dueBoosters } = await db.query(
    `SELECT id FROM immunizations WHERE clinic_id = $1 AND voided_at IS NULL
       AND next_due_at BETWEEN $2::date - 45 AND $2::date + 7 ORDER BY id`,
    [clinicId, today],
  );
  for (const v of dueBoosters)
    if (chance(0.55))
      await call(reception.cookie, 'POST', '/reminders/sent', {
        kind: 'VACCINE',
        targetId: v.id,
      }).catch(() => undefined);
  // El aviso salió unos días antes de la fecha del refuerzo, en horario de atención
  const markReminderDates = () =>
    db.query(
      `UPDATE reminder_logs r
        SET sent_at = LEAST(now(), ((i.next_due_at - 3) + time '10:00' + (r.id % 360) * interval '1 minute') AT TIME ZONE 'America/Lima')
       FROM immunizations i
      WHERE r.kind = 'VACCINE' AND r.target_id = i.id AND r.clinic_id = $1`,
      [clinicId],
    );
  // Los dueños con portal lo abrieron alguna vez
  await db.query(
    `UPDATE portal_links SET view_count = (id % 9) + 1 WHERE clinic_id = $1`,
    [clinicId],
  );
  // Una adenda: el dueño llamó días después de la consulta
  const {
    rows: [lastVisit],
  } = await db.query(
    `SELECT id, closed_at FROM visits
      WHERE clinic_id = $1 AND status = 'CLOSED' AND attended_by_id = $2
        AND closed_at < now() - interval '4 days'
      ORDER BY closed_at DESC LIMIT 1`,
    [clinicId, vet.id],
  );
  if (lastVisit) {
    await call(vet.cookie, 'POST', `/visits/${lastVisit.id}/addenda`, {
      text: 'Llamó la dueña: comió bien y ya no tiene fiebre. Se mantiene el tratamiento hasta completar los 7 días.',
    });
  }
  // La foto de la factura de la última compra (Compras → detalle)
  const {
    rows: [lastPurchase],
  } = await db.query(
    `SELECT id FROM purchases WHERE clinic_id = $1 ORDER BY id DESC LIMIT 1`,
    [clinicId],
  );
  if (lastPurchase) {
    const invoice = new FormData();
    invoice.append(
      'file',
      new Blob([invoicePng()], { type: 'image/png' }),
      'factura-proveedor.png',
    );
    await call(
      admin,
      'POST',
      `/inventory/purchases/${lastPurchase.id}/file`,
      invoice,
    ).catch(() => undefined);
  }
  // Todo esto pasó ayer al cierre (Actividad no lo muestra a una hora de hoy en que nadie trabajó);
  // los avisos y la adenda van luego a su propia fecha
  await shiftTo(block, day(-1), '18:30', '19:20');
  await markReminderDates();
  if (lastVisit)
    await db.query(
      `UPDATE visit_addenda SET created_at = $2::timestamptz + interval '1 day 2 hours' WHERE visit_id = $1`,
      [lastVisit.id, lastVisit.closed_at],
    );

  // ── Controlados, merma y conteo: el inventario muestra su ciclo completo ──
  step('Controlados, merma y conteo físico');
  {
    const patient = pets.find((p) => p.species === 'DOG');
    block = await snapshot();
    await call(
      vet.cookie,
      'POST',
      `/inventory/products/${products.ketamina.id}/outflows`,
      {
        type: 'TREATMENT',
        quantity: 2,
        reason: 'Sedación para curación de herida',
        petId: patient.id,
        prescriptionRef: 'RX-00031',
      },
    );
    await shiftTo(block, day(-11), '11:10', '11:20');
    block = await snapshot();
    await call(
      vet.cookie,
      'POST',
      `/inventory/products/${products.jeringa.id}/outflows`,
      {
        type: 'WASTE',
        quantity: 4,
        reason: 'Empaque dañado al recibir',
      },
    );
    await shiftTo(block, day(-7), '09:30', '09:35');
    block = await snapshot();
    const { data: gloves } = await call(
      admin,
      'GET',
      `/inventory/products/${products.guantes.id}`,
    );
    const lot = gloves.batches.find((b) => b.quantity > 6);
    if (lot)
      await call(
        admin,
        'POST',
        `/inventory/products/${products.guantes.id}/counts`,
        {
          reason: 'Conteo de fin de mes',
          items: [{ batchId: lot.id, counted: lot.quantity - 6 }],
        },
      );
    await shiftTo(block, day(-2), '18:40', '18:45');
  }

  // ── Hoy: la clínica funcionando ──
  step('El día de hoy: cola, consultorio, grooming, citas y caja');
  labStage = 'REQUESTED';
  const todayBlock = await snapshot();
  await openCash();
  // Vacunas y refuerzos que tocan pronto: recordatorios con trabajo
  // Mascotas sin vacunas en la demo: su recordatorio no queda tapado por una vacuna más nueva
  const due = pets
    .filter((p) => ['DOG', 'CAT'].includes(p.species) && p.visits === 0)
    .slice(0, 8);
  for (const [i, p] of due.entries())
    await call(vet.cookie, 'POST', '/immunizations', {
      petId: p.id,
      kind: i % 3 === 2 ? 'DEWORMING_INTERNAL' : 'VACCINE',
      name:
        i % 3 === 2
          ? 'Drontal Plus'
          : p.species === 'CAT'
            ? 'Triple felina'
            : 'Antirrábica',
      appliedAt: day(-360 + i * 3),
      // 3 vencidos, 3 que tocan esta semana y el resto en las próximas semanas
      nextDueAt: day(
        i < 3 ? -between(2, 20) : i < 6 ? between(1, 6) : between(9, 25),
      ),
      externalClinic: i % 2 ? 'Clínica Veterinaria San Roque' : null,
    });
  // Quién está hoy en la clínica (se eligen antes para no cruzar a una mascota en dos lugares)
  const surgeryPet = pickPet((x) => x.species === 'DOG' && x.weightKg > 8);
  const dentalPet = pickPet((x) => x.species === 'DOG' && x !== surgeryPet);
  const inConsult = pickPet(
    (x) => x.species === 'DOG' && ![surgeryPet, dentalPet].includes(x),
  );
  const free = (x) => ![surgeryPet, inConsult].includes(x);
  const waiting = [pickPet(free), pickPet(free), pickPet(free)];
  const groomPets = pets
    .filter(
      (p) =>
        p.species === 'DOG' &&
        !waiting.includes(p) &&
        ![surgeryPet, inConsult].includes(p),
    )
    .slice(-6);
  // Dos clientes nuevos hoy (el mes nunca empieza en cero)
  for (let i = 0; i < 2; i++) await newClient();
  // Atenciones de la mañana, cobradas (una llegó por cita)
  for (let i = 0; i < 4; i++) {
    const p = pickPet(
      (x) =>
        ['DOG', 'CAT'].includes(x.species) &&
        !groomPets.includes(x) &&
        free(x) &&
        !waiting.includes(x),
    );
    let entry;
    if (i === 0) {
      const appt = await call(reception.cookie, 'POST', '/appointments', {
        petId: p.id,
        vetId: vet.id,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        durationMin: 30,
        type: 'CONSULTATION',
        reason: 'Control',
        allowOverlap: true,
      }).catch(() => null);
      if (appt)
        entry = (
          await call(
            reception.cookie,
            'POST',
            `/appointments/${appt.data.id}/arrive`,
          )
        ).data.queueEntryId;
    }
    await consult(p, { appointmentEntry: entry });
    await collectClient(p.clientId);
  }
  // Una cita de la mañana que no vino
  {
    const p = pickPet((x) => !groomPets.includes(x) && free(x));
    const appt = await call(reception.cookie, 'POST', '/appointments', {
      petId: p.id,
      vetId: vet2.id,
      startsAt: new Date(Date.now() - 60_000).toISOString(),
      durationMin: 30,
      type: 'CONSULTATION',
      reason: 'Vacuna anual',
      allowOverlap: true,
    }).catch(() => null);
    if (appt)
      await call(
        reception.cookie,
        'POST',
        `/appointments/${appt.data.id}/no-show`,
      ).catch(() => undefined);
  }
  // Grooming entregados en la mañana
  for (const p of groomPets.slice(0, 2)) {
    await groom(p);
    await collectClient(p.clientId);
  }
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
        {
          productId: products.collar.id,
          presentationId: products.collar.sale,
          quantity: 1,
        },
      ],
    })
  ).data;
  await call(reception.cookie, 'POST', `/estimates/${estimate.id}/accept`, {
    note: 'Aceptó por WhatsApp',
  });
  const surgeryEntry = (
    await call(reception.cookie, 'POST', '/queue', {
      petId: surgeryPet.id,
      reason: 'Castración programada',
    })
  ).data.id;
  const surgeryVisit = (
    await call(vet.cookie, 'POST', '/visits', {
      petId: surgeryPet.id,
      queueEntryId: surgeryEntry,
    })
  ).data.id;
  await call(vet.cookie, 'PATCH', `/visits/${surgeryVisit}`, {
    weightKg: surgeryPet.weightKg,
    temperatureC: 38.5,
    anamnesis: 'Viene en ayunas para su castración.',
    physicalExam: 'Apto para anestesia.',
    diagnosis: 'Paciente sano, apto para cirugía',
    diagnosisDefinitive: true,
    notes: 'Cirugía sin complicaciones. Collar isabelino 10 días.',
  });
  await call(vet.cookie, 'POST', `/estimates/${estimate.id}/convert`, {
    visitId: surgeryVisit,
  }).catch(() => undefined);
  const template = (
    await call(
      vet.cookie,
      'GET',
      `/consents/template?type=SURGERY&petId=${surgeryPet.id}&procedure=${encodeURIComponent('Orquiectomía (castración)')}`,
    )
  ).data;
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
  xray.append(
    'file',
    new Blob([xrayPng()], { type: 'image/png' }),
    'rx-prequirurgica.png',
  );
  await call(vet.cookie, 'POST', `/pets/${surgeryPet.id}/attachments`, xray);
  await call(vet.cookie, 'POST', `/visits/${surgeryVisit}/prescriptions`, {
    notes: 'Collar isabelino 10 días. Control en 7 días.',
    items: [
      {
        productId: products.meloxicam.id,
        presentationId: products.meloxicam.presentations.find(
          (p) => p.factor === 1,
        ).id,
        drug: 'Meloxicam 1 mg',
        dose: '1 tableta',
        route: 'Oral',
        frequency: 'Cada 24 horas',
        duration: '5 días',
        dispenseQuantity: 5,
      },
    ],
  });
  // Otro presupuesto esperando respuesta
  await call(vet2.cookie, 'POST', '/estimates', {
    petId: dentalPet.id,
    title: 'Profilaxis dental con sedación',
    validDays: 15,
    notes: 'Requiere hemograma previo.',
    items: [
      { careServiceId: services.hemograma, quantity: 1 },
      { careServiceId: services.profilaxis, quantity: 1 },
    ],
  });
  // Venta de mostrador y egreso de hoy
  await call(cashier.cookie, 'POST', '/cash/counter-sales', {
    requestKey: randomUUID(),
    items: [
      {
        productId: products.alimento.id,
        presentationId: products.alimento.sale,
        quantity: 1,
      },
    ],
    payments: [{ method: 'PLIN', amount: 89, operationCode: '7731042' }],
    document: 'BOLETA',
  });
  await call(cashier.cookie, 'POST', '/cash/expenses', {
    amount: 15,
    reason: 'Bidón de agua',
  });

  // Citas de la semana
  for (let offset = 1; offset <= 6; offset++) {
    const d = day(offset);
    for (
      let i = 0;
      i < (weekday(d) === 0 ? between(1, 2) : between(3, 6));
      i++
    ) {
      const p = pickPet();
      const grooming = chance(0.3) && p.species === 'DOG';
      await call(reception.cookie, 'POST', '/appointments', {
        petId: p.id,
        vetId: grooming ? pick(groomers).id : pick(vets).id,
        startsAt: limaIso(
          d,
          pick(
            weekday(d) === 0
              ? ['09:30', '10:15', '11:00', '12:00']
              : [
                  '09:00',
                  '09:30',
                  '10:15',
                  '11:00',
                  '11:45',
                  '15:00',
                  '16:30',
                  '17:15',
                ],
          ),
        ),
        durationMin: grooming ? 60 : 30,
        type: grooming ? 'GROOMING' : 'CONSULTATION',
        reason: grooming
          ? 'Baño y corte'
          : pick([
              'Vacuna anual',
              'Control',
              'Desparasitación',
              'Chequeo geriátrico',
            ]),
        allowOverlap: true,
      }).catch(() => undefined);
    }
  }
  // Lo terminado hoy va de la apertura a hace un rato
  const windows = todayWindows();
  await shiftTo(todayBlock, today, windows.done[0], windows.done[1]);

  // Lo que está pasando ahora: tablero de grooming, consultorio y sala de espera (última hora)
  const liveBlock = await snapshot();
  await groom(groomPets[2], { until: 'READY' });
  await groom(groomPets[3], { until: 'CUTTING' });
  await groom(groomPets[4], { until: 'BATHING' });
  await groom(groomPets[5], { until: 'WAITING' });
  await consult(inConsult, { closeIt: false, forcedCase: CASES[5] });
  // En el consultorio ahora mismo: un examen pedido (lo verá Exámenes y la atención)
  {
    const open = (
      await call(vet.cookie, 'GET', `/visits?petId=${inConsult.id}&status=OPEN`)
    ).data.items[0];
    if (open)
      await call(vet.cookie, 'POST', `/visits/${open.id}/lab-orders`, {
        careServiceIds: [services.copro],
        destination: 'IN_HOUSE',
        indication: 'Descartar parásitos',
        charge: true,
      }).catch(() => undefined);
  }
  await call(reception.cookie, 'POST', '/queue', {
    petId: waiting[0].id,
    urgent: true,
    reason: 'Vómitos desde anoche',
  });
  const second = (
    await call(reception.cookie, 'POST', '/queue', {
      petId: waiting[1].id,
      reason: 'Vacuna',
    })
  ).data;
  await call(reception.cookie, 'PATCH', `/queue/${second.id}`, {
    status: 'WAITING',
  }).catch(() => undefined);
  // Lo recogieron en su casa y lo devuelven al terminar
  await call(reception.cookie, 'POST', '/queue', {
    petId: waiting[2].id,
    reason: 'Control de piel',
    transport: 'ROUND_TRIP',
    transportAddress: `${pick(STREETS)} ${between(100, 999)}, ${pick(DISTRICTS)}`,
    transportPrice: 20,
  });
  await shiftTo(liveBlock, today, windows.live[0], windows.live[1]);

  // Citas que faltan hoy (una confirmada) y recojos de grooming más tarde
  for (let i = 0; i < 4; i++) {
    const p = pickPet(
      (x) =>
        !waiting.includes(x) &&
        ![inConsult, surgeryPet, dentalPet].includes(x) &&
        !groomPets.includes(x),
    );
    const appt = await call(reception.cookie, 'POST', '/appointments', {
      petId: p.id,
      vetId: pick(vets).id,
      startsAt: soon(30 + i * 45),
      durationMin: 30,
      type: 'CONSULTATION',
      reason: pick([
        'Vacuna anual',
        'Control',
        'Revisión de herida',
        'Desparasitación',
      ]),
      allowOverlap: true,
    }).catch(() => null);
    if (appt && i === 0)
      await call(
        reception.cookie,
        'POST',
        `/appointments/${appt.data.id}/confirm`,
      ).catch(() => undefined);
  }

  step('Hospitalización: dos internados y un alta reciente');
  const busy = new Set(
    [...waiting, inConsult, surgeryPet, dentalPet, ...groomPets].map(
      (x) => x?.id,
    ),
  );
  const freePet = (species) => {
    const p = pickPet((x) => x.species === species && !busy.has(x.id));
    if (p) busy.add(p.id);
    return p;
  };
  await seedHospital({
    cookie: vet.cookie,
    staff: [vet.id, vet2.id, vet.id],
    stayServiceId: services.hospitalizacion,
    services,
    dog: freePet('DOG'),
    cat: freePet('CAT'),
    past: freePet('DOG'),
  });
  await fixTodayPlans();
  await markExpiringLot();

  const counts = await db.query(
    `SELECT (SELECT count(*) FROM clients WHERE clinic_id=$1) AS clients,
            (SELECT count(*) FROM pets WHERE clinic_id=$1) AS pets,
            (SELECT count(*) FROM visits WHERE clinic_id=$1) AS visits,
            (SELECT count(*) FROM receipts WHERE clinic_id=$1) AS receipts,
            (SELECT count(*) FROM grooming_sessions WHERE clinic_id=$1) AS grooming,
            (SELECT count(*) FROM hospitalizations WHERE clinic_id=$1 AND status = 'ACTIVE') AS hospitalized`,
    [clinicId],
  );
  const c = counts.rows[0];
  console.log(
    `\n✓ Demo lista: ${c.clients} clientes, ${c.pets} mascotas, ${c.visits} atenciones, ${c.receipts} cobros, ${c.grooming} servicios de grooming y ${c.hospitalized} internados.`,
  );
  console.log(
    `  Entran con la clave ${owner.password === DEMO_PASSWORD ? 'DEMO_PASSWORD' : 'DEMO_PASSWORD (el administrador, con la suya)'}:`,
  );
  console.log(`  admin      ${owner.email}`);
  for (const [key, member] of Object.entries(team))
    console.log(`  ${key.padEnd(10)} ${member.email} · ${member.name}`);
  await db.end();
}

(REFRESH ? refresh() : main()).catch(async (error) => {
  await db.query('ROLLBACK').catch(() => undefined);
  await db.end().catch(() => undefined);
  fail(error instanceof Error ? error.message : String(error));
});
