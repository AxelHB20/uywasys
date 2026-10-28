-- CreateEnum
CREATE TYPE "VisitStatus" AS ENUM ('OPEN', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeKind" AS ENUM ('SERVICE', 'PRODUCT');

-- CreateEnum
CREATE TYPE "ChargeStatus" AS ENUM ('PENDING', 'PAID', 'VOID');

-- AlterTable
ALTER TABLE "clinics" ADD COLUMN     "max_discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 10;

-- CreateTable
CREATE TABLE "visits" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "queue_entry_id" INTEGER,
    "type" "VisitType" NOT NULL DEFAULT 'CONSULTATION',
    "status" "VisitStatus" NOT NULL DEFAULT 'OPEN',
    "reason" VARCHAR(200),
    "weight_kg" DECIMAL(5,2),
    "temperature_c" DECIMAL(4,1),
    "notes" TEXT,
    "attended_by_id" INTEGER NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" INTEGER,
    "cancel_reason" VARCHAR(200),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "visits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "visit_addenda" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "author_id" INTEGER NOT NULL,
    "text" VARCHAR(2000) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "visit_addenda_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "charges" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "visit_id" INTEGER,
    "pet_id" INTEGER,
    "kind" "ChargeKind" NOT NULL,
    "care_service_id" INTEGER,
    "product_id" INTEGER,
    "presentation_id" INTEGER,
    "description" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discount_reason" VARCHAR(120),
    "igv_affectation" "IgvAffectation" NOT NULL,
    "igv_rate" DECIMAL(5,4) NOT NULL,
    "sunat_unit" VARCHAR(3) NOT NULL,
    "taxable_amount" DECIMAL(12,2) NOT NULL,
    "igv_amount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "prescription_ref" VARCHAR(60),
    "vet_id" INTEGER,
    "status" "ChargeStatus" NOT NULL DEFAULT 'PENDING',
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_id" INTEGER,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(200),

    CONSTRAINT "charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_shortages" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "charge_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ(3),
    "resolved_by_id" INTEGER,
    "resolution" VARCHAR(200),

    CONSTRAINT "stock_shortages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "visits_clinic_id_status_idx" ON "visits"("clinic_id", "status");

-- CreateIndex
CREATE INDEX "visits_pet_id_opened_at_idx" ON "visits"("pet_id", "opened_at");

-- CreateIndex
CREATE INDEX "visits_client_id_idx" ON "visits"("client_id");

-- CreateIndex
CREATE INDEX "visits_queue_entry_id_idx" ON "visits"("queue_entry_id");

-- CreateIndex
CREATE INDEX "visit_addenda_visit_id_idx" ON "visit_addenda"("visit_id");

-- CreateIndex
CREATE INDEX "charges_clinic_id_client_id_status_idx" ON "charges"("clinic_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "charges_clinic_id_created_at_idx" ON "charges"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "charges_visit_id_idx" ON "charges"("visit_id");

-- CreateIndex
CREATE INDEX "charges_product_id_idx" ON "charges"("product_id");

-- CreateIndex
CREATE INDEX "charges_care_service_id_idx" ON "charges"("care_service_id");

-- CreateIndex
CREATE INDEX "stock_shortages_clinic_id_resolved_at_idx" ON "stock_shortages"("clinic_id", "resolved_at");

-- CreateIndex
CREATE INDEX "stock_shortages_charge_id_idx" ON "stock_shortages"("charge_id");

-- CreateIndex
CREATE INDEX "stock_shortages_product_id_idx" ON "stock_shortages"("product_id");

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_queue_entry_id_fkey" FOREIGN KEY ("queue_entry_id") REFERENCES "queue_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_attended_by_id_fkey" FOREIGN KEY ("attended_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visits" ADD CONSTRAINT "visits_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_addenda" ADD CONSTRAINT "visit_addenda_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_addenda" ADD CONSTRAINT "visit_addenda_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "visit_addenda" ADD CONSTRAINT "visit_addenda_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_care_service_id_fkey" FOREIGN KEY ("care_service_id") REFERENCES "care_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_vet_id_fkey" FOREIGN KEY ("vet_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "charges" ADD CONSTRAINT "charges_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_shortages" ADD CONSTRAINT "stock_shortages_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_shortages" ADD CONSTRAINT "stock_shortages_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_shortages" ADD CONSTRAINT "stock_shortages_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_shortages" ADD CONSTRAINT "stock_shortages_resolved_by_id_fkey" FOREIGN KEY ("resolved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
