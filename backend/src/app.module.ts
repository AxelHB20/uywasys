import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { MedicalModule } from './medical/medical.module.js';
import { ActivityModule } from './activity/activity.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CareServicesModule } from './care-services/care-services.module.js';
import { CashModule } from './cash/cash.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { ClinicModule } from './clinic/clinic.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { MailModule } from './common/mail/mail.module.js';
import { validateEnv } from './config/env.validation.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { GroomingModule } from './grooming/grooming.module.js';
import { HospitalizationModule } from './hospitalization/hospitalization.module.js';
import { HealthModule } from './health/health.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PetsModule } from './pets/pets.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { PortalModule } from './portal/portal.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueueModule } from './queue/queue.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { UsersModule } from './users/users.module.js';
import { VisitsModule } from './visits/visits.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    // Límite de peticiones por conexión: frena robots y pruebas de contraseñas en masa.
    // El login tiene su propio límite, más bajo (ver AuthController).
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          { ttl: 60_000, limit: config.get<number>('API_RATE_LIMIT', 600) },
        ],
        errorMessage:
          'Demasiados intentos seguidos. Espera un minuto y vuelve a intentarlo',
      }),
    }),
    PrismaModule,
    AuditModule,
    MailModule,
    AuthModule,
    ClinicModule,
    UsersModule,
    ClientsModule,
    PetsModule,
    QueueModule,
    DashboardModule,
    InventoryModule,
    CareServicesModule,
    VisitsModule,
    CashModule,
    ActivityModule,
    MedicalModule,
    PortalModule,
    RemindersModule,
    NotificationsModule,
    GroomingModule,
    HospitalizationModule,
    ReportsModule,
    HealthModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
