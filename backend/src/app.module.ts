import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './auth/auth.module.js';
import { CareServicesModule } from './care-services/care-services.module.js';
import { ClientsModule } from './clients/clients.module.js';
import { ClinicModule } from './clinic/clinic.module.js';
import { AuditModule } from './common/audit/audit.module.js';
import { validateEnv } from './config/env.validation.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { HealthModule } from './health/health.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PetsModule } from './pets/pets.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { QueueModule } from './queue/queue.module.js';
import { UsersModule } from './users/users.module.js';
import { VisitsModule } from './visits/visits.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    PrismaModule,
    AuditModule,
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
    HealthModule,
  ],
})
export class AppModule {}
