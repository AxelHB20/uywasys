import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

/**
 * Las fechas no deben depender de la zona horaria del servidor de PostgreSQL. En Docker la base
 * de datos corre en hora de Lima (TZ) y el adaptador de Prisma manda las fechas sin zona: si la
 * sesión no está en UTC, todo lo guardado queda 5 horas corrido (ventas de la noche en el día
 * siguiente, esperas negativas, reportes vacíos). Correr también con:
 *   ALTER DATABASE uywasys SET timezone TO 'America/Lima';
 */
describe('Zona horaria de la base de datos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('la sesión de la API siempre trabaja en UTC', async () => {
    const [{ tz }] = await prisma.$queryRaw<
      { tz: string }[]
    >`SELECT current_setting('TimeZone') AS tz`;
    expect(tz).toBe('UTC');
  });

  it('una fecha guardada por la API es la hora real (sin corrimiento)', async () => {
    const clinic = await prisma.clinic.create({
      data: { name: 'Clínica e2e zona horaria' },
    });
    try {
      const [{ now }] = await prisma.$queryRaw<
        { now: Date }[]
      >`SELECT now() AS now`;
      const written = clinic.createdAt.getTime();
      const stored = (
        await prisma.clinic.findUniqueOrThrow({ where: { id: clinic.id } })
      ).createdAt;
      expect(Math.abs(stored.getTime() - now.getTime())).toBeLessThan(60_000);
      expect(stored.getTime()).toBe(written);
      // Y leída con SQL directo, la misma hora
      const [{ at }] = await prisma.$queryRaw<
        { at: Date }[]
      >`SELECT created_at AS at FROM clinics WHERE id = ${clinic.id}`;
      expect(at.getTime()).toBe(written);
    } finally {
      await prisma.clinic.delete({ where: { id: clinic.id } });
    }
  });
});
