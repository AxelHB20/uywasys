/**
 * Clínica de pruebas para las pruebas en el navegador (carpeta e2e): así la demostración y los datos
 * reales nunca se llenan de "Cliente E2E", "Dra. Prueba" ni cobros de prueba.
 *
 * Crea (solo si no existe) la clínica "Clínica de pruebas (E2E)" con su administrador. Lo demás
 * (veterinarios, servicios, productos, caja) lo crean las mismas pruebas.
 *
 * Variables:
 *   E2E_EMAIL     correo del administrador de pruebas (por defecto e2e@uywa.pe)
 *   E2E_PASSWORD  su clave (10+ caracteres, letras y números)
 *   DATABASE_URL  la base de datos (dentro de Docker ya está definida)
 *
 * Local:  docker compose exec -e E2E_PASSWORD=Pruebas2026clave api node scripts/e2e-clinic.mjs
 * Luego:  cd e2e && E2E_EMAIL=e2e@uywa.pe E2E_PASSWORD=Pruebas2026clave npx playwright test
 *
 * No la crees en el servidor de la clínica: es solo para la computadora de desarrollo.
 */
import bcrypt from 'bcryptjs';
import pg from 'pg';

const email = (process.env.E2E_EMAIL ?? 'e2e@uywa.pe').trim().toLowerCase();
const password = process.env.E2E_PASSWORD ?? '';

if (password.length < 10 || !/[a-z]/i.test(password) || !/\d/.test(password)) {
  console.error('Define E2E_PASSWORD: 10 caracteres o más, con letras y números.');
  process.exit(1);
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  const found = await db.query('SELECT clinic_id FROM users WHERE email = $1', [email]);
  if (found.rows.length) {
    console.log(`La clínica de pruebas ya existe (${email}); no se cambió nada.`);
  } else {
    await db.query('BEGIN');
    const clinic = await db.query(
      `INSERT INTO clinics (name, updated_at) VALUES ('Clínica de pruebas (E2E)', now()) RETURNING id`,
    );
    await db.query(
      `INSERT INTO users (clinic_id, full_name, email, password_hash, role, license_number, updated_at)
       VALUES ($1, 'Admin de pruebas', $2, $3, 'ADMIN', '00000', now())`,
      [clinic.rows[0].id, email, await bcrypt.hash(password, 10)],
    );
    await db.query('COMMIT');
    console.log(`Listo: clínica de pruebas creada. Entra con ${email}.`);
  }
} catch (error) {
  await db.query('ROLLBACK').catch(() => {});
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await db.end();
}
