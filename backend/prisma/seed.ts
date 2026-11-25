/**
 * Crea la primera clínica y su administrador. Se ejecuta con: npx prisma db seed
 * Toma los datos de .env (SEED_CLINIC_NAME, SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD).
 * Si el administrador ya existe, no cambia nada.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import bcrypt from 'bcryptjs';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({
    connectionString: process.env.DATABASE_URL ?? '',
    options: '-c timezone=UTC',
  }),
});

async function main(): Promise<void> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? '').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD ?? '';
  if (!email || password.length < 8) {
    throw new Error(
      'Define SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD (mínimo 8 caracteres) en el archivo .env',
    );
  }

  if (await prisma.user.findUnique({ where: { email } })) {
    console.log(`El usuario ${email} ya existe; no se cambió nada.`);
    return;
  }

  const clinic =
    (await prisma.clinic.findFirst({ orderBy: { id: 'asc' } })) ??
    (await prisma.clinic.create({
      data: { name: process.env.SEED_CLINIC_NAME?.trim() || 'Mi veterinaria' },
    }));

  await prisma.user.create({
    data: {
      clinicId: clinic.id,
      fullName: process.env.SEED_ADMIN_NAME?.trim() || 'Administrador',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: Role.ADMIN,
    },
  });
  console.log(`Listo: ${email} es administrador de "${clinic.name}".`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
