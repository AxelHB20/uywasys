-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('DNI', 'CE', 'RUC', 'PASSPORT');

-- CreateEnum
CREATE TYPE "Species" AS ENUM ('DOG', 'CAT', 'RABBIT', 'GUINEA_PIG', 'BIRD', 'REPTILE', 'OTHER');

-- CreateEnum
CREATE TYPE "PetSex" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "VisitType" AS ENUM ('CONSULTATION', 'GROOMING');

-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('ARRIVED', 'WAITING', 'IN_PROGRESS', 'DONE', 'CANCELLED');

-- CreateTable
CREATE TABLE "clients" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "doc_type" "DocumentType",
    "doc_number" VARCHAR(12),
    "name" VARCHAR(150) NOT NULL,
    "phone" CHAR(9) NOT NULL,
    "email" VARCHAR(120),
    "address" VARCHAR(200),
    "district" VARCHAR(60),
    "notes" VARCHAR(500),
    "consent_at" TIMESTAMPTZ(3) NOT NULL,
    "consent_version" VARCHAR(20) NOT NULL,
    "consent_channel" VARCHAR(10) NOT NULL,
    "consent_by_id" INTEGER,
    "marketing_consent" BOOLEAN NOT NULL DEFAULT false,
    "search_text" VARCHAR(200) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "authorized_people" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "dni" CHAR(8),
    "phone" CHAR(9),
    "relation" VARCHAR(40),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authorized_people_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pets" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "name_search" VARCHAR(60) NOT NULL,
    "species" "Species" NOT NULL,
    "breed" VARCHAR(60),
    "sex" "PetSex",
    "neutered" BOOLEAN NOT NULL DEFAULT false,
    "birth_date" DATE,
    "birth_date_estimated" BOOLEAN NOT NULL DEFAULT false,
    "weight_kg" DECIMAL(5,2),
    "color" VARCHAR(40),
    "microchip" VARCHAR(20),
    "allergies" VARCHAR(300),
    "aggressive" BOOLEAN NOT NULL DEFAULT false,
    "aggressive_note" VARCHAR(200),
    "notes" VARCHAR(500),
    "deceased_at" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "pets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "queue_entries" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "day" DATE NOT NULL,
    "type" "VisitType" NOT NULL DEFAULT 'CONSULTATION',
    "status" "QueueStatus" NOT NULL DEFAULT 'ARRIVED',
    "urgent" BOOLEAN NOT NULL DEFAULT false,
    "reason" VARCHAR(200),
    "arrived_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMPTZ(3),
    "finished_at" TIMESTAMPTZ(3),
    "created_by_id" INTEGER NOT NULL,
    "attended_by_id" INTEGER,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "clients_clinic_id_name_idx" ON "clients"("clinic_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "clients_clinic_id_doc_type_doc_number_key" ON "clients"("clinic_id", "doc_type", "doc_number");

-- CreateIndex
CREATE INDEX "authorized_people_client_id_idx" ON "authorized_people"("client_id");

-- CreateIndex
CREATE INDEX "pets_client_id_idx" ON "pets"("client_id");

-- CreateIndex
CREATE INDEX "pets_clinic_id_client_id_idx" ON "pets"("clinic_id", "client_id");

-- CreateIndex
CREATE INDEX "queue_entries_clinic_id_day_idx" ON "queue_entries"("clinic_id", "day");

-- CreateIndex
CREATE INDEX "queue_entries_pet_id_idx" ON "queue_entries"("pet_id");

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_people" ADD CONSTRAINT "authorized_people_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "authorized_people" ADD CONSTRAINT "authorized_people_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pets" ADD CONSTRAINT "pets_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_attended_by_id_fkey" FOREIGN KEY ("attended_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
