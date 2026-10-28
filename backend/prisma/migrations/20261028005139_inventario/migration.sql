-- CreateEnum
CREATE TYPE "ProductCategory" AS ENUM ('MEDICINE', 'VACCINE', 'ANTIPARASITIC', 'FOOD', 'ACCESSORY', 'HYGIENE', 'SUPPLY');

-- CreateEnum
CREATE TYPE "BaseUnit" AS ENUM ('UNIT', 'TABLET', 'ML', 'G');

-- CreateEnum
CREATE TYPE "IgvAffectation" AS ENUM ('TAXED', 'EXEMPT', 'UNAFFECTED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('PURCHASE', 'WASTE', 'TREATMENT', 'COUNT_ADJUST', 'RETURN', 'SALE');

-- CreateEnum
CREATE TYPE "CareServiceCategory" AS ENUM ('CONSULTATION', 'VACCINATION', 'DEWORMING', 'SURGERY', 'LAB', 'GROOMING', 'OTHER');

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "code" VARCHAR(30),
    "barcode" VARCHAR(30),
    "name" VARCHAR(120) NOT NULL,
    "name_search" VARCHAR(120) NOT NULL,
    "category" "ProductCategory" NOT NULL,
    "base_unit" "BaseUnit" NOT NULL,
    "min_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "requires_prescription" BOOLEAN NOT NULL DEFAULT false,
    "controlled" BOOLEAN NOT NULL DEFAULT false,
    "sunat_unit" VARCHAR(3) NOT NULL DEFAULT 'NIU',
    "igv" "IgvAffectation" NOT NULL DEFAULT 'TAXED',
    "total_stock" DECIMAL(12,3) NOT NULL DEFAULT 0,
    "notes" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_presentations" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "factor" DECIMAL(12,3) NOT NULL,
    "price" DECIMAL(10,2),
    "barcode" VARCHAR(30),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "product_presentations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_batches" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "lot_number" VARCHAR(40),
    "expires_at" DATE,
    "quantity" DECIMAL(12,3) NOT NULL,
    "initial_quantity" DECIMAL(12,3) NOT NULL,
    "unit_cost" DECIMAL(12,4),
    "supplier" VARCHAR(120),
    "document_number" VARCHAR(30),
    "received_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" INTEGER NOT NULL,

    CONSTRAINT "product_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" BIGSERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "batch_id" INTEGER,
    "type" "MovementType" NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "balance_after" DECIMAL(12,3) NOT NULL,
    "reason" VARCHAR(200),
    "user_id" INTEGER NOT NULL,
    "pet_id" INTEGER,
    "vet_id" INTEGER,
    "prescription_ref" VARCHAR(60),
    "ref_type" VARCHAR(20),
    "ref_id" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_services" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "category" "CareServiceCategory" NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "igv" "IgvAffectation" NOT NULL DEFAULT 'TAXED',
    "duration_min" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "care_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "care_service_supplies" (
    "service_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "care_service_supplies_pkey" PRIMARY KEY ("service_id","product_id")
);

-- CreateIndex
CREATE INDEX "products_clinic_id_name_idx" ON "products"("clinic_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "products_clinic_id_code_key" ON "products"("clinic_id", "code");

-- CreateIndex
CREATE UNIQUE INDEX "product_presentations_product_id_name_key" ON "product_presentations"("product_id", "name");

-- CreateIndex
CREATE INDEX "product_batches_product_id_expires_at_idx" ON "product_batches"("product_id", "expires_at");

-- CreateIndex
CREATE INDEX "product_batches_clinic_id_expires_at_idx" ON "product_batches"("clinic_id", "expires_at");

-- CreateIndex
CREATE INDEX "stock_movements_product_id_created_at_idx" ON "stock_movements"("product_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_clinic_id_created_at_idx" ON "stock_movements"("clinic_id", "created_at");

-- CreateIndex
CREATE INDEX "stock_movements_batch_id_idx" ON "stock_movements"("batch_id");

-- CreateIndex
CREATE INDEX "stock_movements_pet_id_idx" ON "stock_movements"("pet_id");

-- CreateIndex
CREATE UNIQUE INDEX "care_services_clinic_id_name_key" ON "care_services"("clinic_id", "name");

-- CreateIndex
CREATE INDEX "care_service_supplies_product_id_idx" ON "care_service_supplies"("product_id");

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_presentations" ADD CONSTRAINT "product_presentations_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_presentations" ADD CONSTRAINT "product_presentations_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_vet_id_fkey" FOREIGN KEY ("vet_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_services" ADD CONSTRAINT "care_services_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_service_supplies" ADD CONSTRAINT "care_service_supplies_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "care_services"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "care_service_supplies" ADD CONSTRAINT "care_service_supplies_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
