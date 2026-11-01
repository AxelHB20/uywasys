-- Fase 5, paso 1: consulta SOAP y carnet de vacunas

-- AlterTable: consulta con método SOAP
ALTER TABLE "visits"
    ADD COLUMN "anamnesis" TEXT,
    ADD COLUMN "heart_rate" SMALLINT,
    ADD COLUMN "respiratory_rate" SMALLINT,
    ADD COLUMN "capillary_refill_s" DECIMAL(3,1),
    ADD COLUMN "mucosa" VARCHAR(40),
    ADD COLUMN "hydration" VARCHAR(40),
    ADD COLUMN "body_condition" SMALLINT,
    ADD COLUMN "physical_exam" TEXT,
    ADD COLUMN "diagnosis" VARCHAR(300),
    ADD COLUMN "diagnosis_definitive" BOOLEAN NOT NULL DEFAULT false;

-- CreateEnum
CREATE TYPE "ImmunizationKind" AS ENUM ('VACCINE', 'DEWORMING_INTERNAL', 'DEWORMING_EXTERNAL');

-- CreateTable
CREATE TABLE "immunizations" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "visit_id" INTEGER,
    "kind" "ImmunizationKind" NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "laboratory" VARCHAR(60),
    "batch_number" VARCHAR(40),
    "applied_at" DATE NOT NULL,
    "next_due_at" DATE,
    "external" BOOLEAN NOT NULL DEFAULT false,
    "external_clinic" VARCHAR(120),
    "notes" VARCHAR(300),
    "applied_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" INTEGER,
    "void_reason" VARCHAR(200),

    CONSTRAINT "immunizations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "immunizations_pet_id_applied_at_idx" ON "immunizations"("pet_id", "applied_at");
CREATE INDEX "immunizations_clinic_id_next_due_at_idx" ON "immunizations"("clinic_id", "next_due_at");
CREATE INDEX "immunizations_visit_id_idx" ON "immunizations"("visit_id");

-- AddForeignKey
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_applied_by_id_fkey" FOREIGN KEY ("applied_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "immunizations" ADD CONSTRAINT "immunizations_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
