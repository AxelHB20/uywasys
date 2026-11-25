-- Plantillas clínicas (consultas y recetas frecuentes) y hospitalización básica

-- AlterEnum
ALTER TYPE "VisitType" ADD VALUE 'HOSPITALIZATION';
ALTER TYPE "CareServiceCategory" ADD VALUE 'HOSPITALIZATION' BEFORE 'OTHER';

-- CreateEnum
CREATE TYPE "TemplateKind" AS ENUM ('CONSULTATION', 'PRESCRIPTION');
CREATE TYPE "HospitalizationStatus" AS ENUM ('ACTIVE', 'DISCHARGED', 'DECEASED');
CREATE TYPE "HospOrderKind" AS ENUM ('MEDICATION', 'FLUIDS', 'FEEDING', 'PROCEDURE', 'MONITORING');
CREATE TYPE "HospEntryKind" AS ENUM ('DOSE', 'VITALS', 'NOTE');

-- CreateTable
CREATE TABLE "clinical_templates" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "kind" "TemplateKind" NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "content" JSONB NOT NULL,
    "usage_count" INTEGER NOT NULL DEFAULT 0,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clinical_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitalizations" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "vet_id" INTEGER NOT NULL,
    "cage" VARCHAR(30),
    "reason" VARCHAR(200) NOT NULL,
    "diagnosis" VARCHAR(300),
    "status" "HospitalizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "admitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "admitted_by_id" INTEGER NOT NULL,
    "discharged_at" TIMESTAMPTZ(3),
    "discharged_by_id" INTEGER,
    "discharge_notes" VARCHAR(1000),
    "days_charged" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hospitalizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitalization_orders" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "hospitalization_id" INTEGER NOT NULL,
    "kind" "HospOrderKind" NOT NULL,
    "description" VARCHAR(150) NOT NULL,
    "dose" VARCHAR(80),
    "route" VARCHAR(40),
    "every_hours" SMALLINT,
    "starts_at" TIMESTAMPTZ(3) NOT NULL,
    "ends_at" TIMESTAMPTZ(3),
    "notes" VARCHAR(300),
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "stopped_at" TIMESTAMPTZ(3),
    "stopped_by_id" INTEGER,

    CONSTRAINT "hospitalization_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitalization_entries" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "hospitalization_id" INTEGER NOT NULL,
    "kind" "HospEntryKind" NOT NULL,
    "order_id" INTEGER,
    "scheduled_at" TIMESTAMPTZ(3),
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "temperature_c" DECIMAL(4,1),
    "heart_rate" SMALLINT,
    "respiratory_rate" SMALLINT,
    "weight_kg" DECIMAL(5,2),
    "mucosa" VARCHAR(40),
    "notes" VARCHAR(500),
    "by_id" INTEGER NOT NULL,

    CONSTRAINT "hospitalization_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "clinical_templates_clinic_id_kind_name_key" ON "clinical_templates"("clinic_id", "kind", "name");
CREATE UNIQUE INDEX "hospitalizations_visit_id_key" ON "hospitalizations"("visit_id");
CREATE INDEX "hospitalizations_clinic_id_status_idx" ON "hospitalizations"("clinic_id", "status");
CREATE INDEX "hospitalizations_pet_id_admitted_at_idx" ON "hospitalizations"("pet_id", "admitted_at");
CREATE UNIQUE INDEX "hospitalizations_clinic_id_number_key" ON "hospitalizations"("clinic_id", "number");
CREATE INDEX "hospitalization_orders_hospitalization_id_idx" ON "hospitalization_orders"("hospitalization_id");
CREATE INDEX "hospitalization_entries_hospitalization_id_at_idx" ON "hospitalization_entries"("hospitalization_id", "at");
CREATE INDEX "hospitalization_entries_order_id_scheduled_at_idx" ON "hospitalization_entries"("order_id", "scheduled_at");

-- AddForeignKey
ALTER TABLE "clinical_templates" ADD CONSTRAINT "clinical_templates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "clinical_templates" ADD CONSTRAINT "clinical_templates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_vet_id_fkey" FOREIGN KEY ("vet_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_admitted_by_id_fkey" FOREIGN KEY ("admitted_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalizations" ADD CONSTRAINT "hospitalizations_discharged_by_id_fkey" FOREIGN KEY ("discharged_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_hospitalization_id_fkey" FOREIGN KEY ("hospitalization_id") REFERENCES "hospitalizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_stopped_by_id_fkey" FOREIGN KEY ("stopped_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_hospitalization_id_fkey" FOREIGN KEY ("hospitalization_id") REFERENCES "hospitalizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "hospitalization_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hospitalization_entries" ADD CONSTRAINT "hospitalization_entries_by_id_fkey" FOREIGN KEY ("by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
