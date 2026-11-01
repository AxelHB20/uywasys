import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const config = app.get(ConfigService);

  configureApp(app);
  // Detrás de Caddy: sin esto todas las peticiones parecen venir del proxy (bitácora y límites).
  if (config.get<boolean>('TRUST_PROXY')) app.set('trust proxy', 1);
  const corsOrigin = config.get<string>('CORS_ORIGIN');
  if (corsOrigin)
    app.enableCors({ origin: corsOrigin.split(','), credentials: true });
  app.enableShutdownHooks();

  const port = config.get<number>('PORT', 3000);
  await app.listen(port);
  Logger.log(
    `UywaSys API escuchando en http://localhost:${port}/api`,
    'Bootstrap',
  );
}

await bootstrap();
