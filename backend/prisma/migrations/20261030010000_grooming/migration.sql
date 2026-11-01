-- Fase 6, paso 1: grooming (precios por tamaño, comisión del groomer y servicios de baño y peluquería)

-- CreateEnum
CREATE TYPE "PetSize" AS ENUM ('SMALL', 'MEDIUM', 'LARGE', 'GIANT');
CREATE TYPE "GroomingStatus" AS ENUM ('WAITING', 'BATHING', 'CUTTING', 'READY', 'DELIVERED', 'CANCELLED');
CREATE TYPE "GroomingTransport" AS ENUM ('NONE', 'PICKUP', 'DROPOFF', 'ROUND_TRIP');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "commission_percent" DECIMAL(5,2);

-- CreateTable
CREATE TABLE "care_service_size_prices" (
    "service_id" INTEGER NOT NULL,
    "size" "PetSize" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "care_service_size_prices_pkey" PRIMARY KEY ("service_id","size")
);

-- CreateTable
CREATE TABLE "grooming_sessions" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "size" "PetSize" NOT NULL,
    "status" "GroomingStatus" NOT NULL DEFAULT 'WAITING',
    "groomer_id" INTEGER,
    "promised_at" TIMESTAMPTZ(3),
    "fleas" BOOLEAN NOT NULL DEFAULT false,
    "ticks" BOOLEAN NOT NULL DEFAULT false,
    "matting" BOOLEAN NOT NULL DEFAULT false,
    "aggressive" BOOLEAN NOT NULL DEFAULT false,
    "skin_notes" VARCHAR(300),
    "belongings" VARCHAR(200),
    "instructions" VARCHAR(300),
    "transport" "GroomingTransport" NOT NULL DEFAULT 'NONE',
    "transport_address" VARCHAR(200),
    "signer_name" VARCHAR(150),
    "signature" BYTEA,
    "check_in_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bathing_at" TIMESTAMPTZ(3),
    "cutting_at" TIMESTAMPTZ(3),
    "ready_at" TIMESTAMPTZ(3),
    "notified_at" TIMESTAMPTZ(3),
    "delivered_at" TIMESTAMPTZ(3),
    "picked_up_by" VARCHAR(150),
    "picked_up_document" VARCHAR(20),
    "picked_up_relation" VARCHAR(40),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancel_reason" VARCHAR(200),
    "created_by_id" INTEGER NOT NULL,
    "delivered_by_id" INTEGER,
    "cancelled_by_id" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "grooming_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "grooming_sessions_visit_id_key" ON "grooming_sessions"("visit_id");
CREATE UNIQUE INDEX "grooming_sessions_clinic_id_number_key" ON "grooming_sessions"("clinic_id", "number");
CREATE INDEX "grooming_sessions_clinic_id_day_idx" ON "grooming_sessions"("clinic_id", "day");
CREATE INDEX "grooming_sessions_clinic_id_status_idx" ON "grooming_sessions"("clinic_id", "status");
CREATE INDEX "grooming_sessions_pet_id_check_in_at_idx" ON "grooming_sessions"("pet_id", "check_in_at");
CREATE INDEX "grooming_sessions_groomer_id_delivered_at_idx" ON "grooming_sessions"("groomer_id", "delivered_at");

-- AddForeignKey
ALTER TABLE "care_service_size_prices" ADD CONSTRAINT "care_service_size_prices_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "care_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_groomer_id_fkey" FOREIGN KEY ("groomer_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_delivered_by_id_fkey" FOREIGN KEY ("delivered_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "grooming_sessions" ADD CONSTRAINT "grooming_sessions_cancelled_by_id_fkey" FOREIGN KEY ("cancelled_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
