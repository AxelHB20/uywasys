import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { requestId } from './common/http/request-id.js';

/** Configuración común de la app; la usan main.ts y las pruebas e2e para comportarse igual. */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
  app.use(requestId);
  app.use(helmet());
  app.use(cookieParser());
  // El consentimiento firmado viaja con la firma en PNG: el tope por defecto (100 kB) no alcanza
  (app as NestExpressApplication).useBodyParser('json', { limit: '1mb' });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // descarta campos que el DTO no declara
      forbidNonWhitelisted: true, // y avisa si alguien los envía
      transform: true,
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
}
