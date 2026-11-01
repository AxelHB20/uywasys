-- Fase 5, paso 4: presupuestos

-- CreateEnum
CREATE TYPE "EstimateStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REJECTED', 'CONVERTED');

-- CreateTable
CREATE TABLE "estimates" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "valid_until" DATE NOT NULL,
    "notes" VARCHAR(1000),
    "status" "EstimateStatus" NOT NULL DEFAULT 'PENDING',
    "total" DECIMAL(12,2) NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decided_at" TIMESTAMPTZ(3),
    "decided_by_id" INTEGER,
    "decision_note" VARCHAR(200),
    "visit_id" INTEGER,
    "converted_at" TIMESTAMPTZ(3),
    "converted_by_id" INTEGER,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_items" (
    "id" SERIAL NOT NULL,
    "estimate_id" INTEGER NOT NULL,
    "position" SMALLINT NOT NULL,
    "care_service_id" INTEGER,
    "product_id" INTEGER,
    "presentation_id" INTEGER,
    "description" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(10,3) NOT NULL,
    "unit_price" DECIMAL(10,2) NOT NULL,
    "discount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "igv_affectation" "IgvAffectation" NOT NULL,
    "controlled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "estimate_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estimates_clinic_id_number_key" ON "estimates"("clinic_id", "number");
CREATE INDEX "estimates_clinic_id_status_idx" ON "estimates"("clinic_id", "status");
CREATE INDEX "estimates_pet_id_idx" ON "estimates"("pet_id");
CREATE INDEX "estimate_items_estimate_id_idx" ON "estimate_items"("estimate_id");

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_decided_by_id_fkey" FOREIGN KEY ("decided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_converted_by_id_fkey" FOREIGN KEY ("converted_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_estimate_id_fkey" FOREIGN KEY ("estimate_id") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_care_service_id_fkey" FOREIGN KEY ("care_service_id") REFERENCES "care_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "estimate_items" ADD CONSTRAINT "estimate_items_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
