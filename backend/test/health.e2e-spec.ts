import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

// Requiere la base de datos levantada (docker compose up -d) y DATABASE_URL en .env
describe('API (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET /api/health responde ok con la base de datos arriba', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health')
      .expect(200);
    expect(res.body).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('una ruta inexistente responde 404 con el formato de error de la API', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/no-existe')
      .expect(404);
    expect(res.body).toMatchObject({ statusCode: 404, path: '/api/no-existe' });
  });
});
