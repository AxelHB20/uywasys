-- Compras y proveedores: la ficha de compra con sus líneas (un lote por línea) y la lista de proveedores.
ALTER TYPE "MovementType" ADD VALUE 'PURCHASE_VOID';
CREATE TYPE "PurchaseDocType" AS ENUM ('FACTURA', 'BOLETA', 'GUIA', 'OTRO');
CREATE TYPE "PurchaseStatus" AS ENUM ('RECEIVED', 'VOIDED');

CREATE TABLE "suppliers" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "name_search" VARCHAR(150) NOT NULL,
    "ruc" VARCHAR(11),
    "contact" VARCHAR(100),
    "phone" VARCHAR(15),
    "email" VARCHAR(120),
    "notes" VARCHAR(300),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "suppliers_clinic_id_ruc_key" ON "suppliers"("clinic_id", "ruc");
CREATE INDEX "suppliers_clinic_id_name_search_idx" ON "suppliers"("clinic_id", "name_search");
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchases" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "supplier_id" INTEGER NOT NULL,
    "doc_type" "PurchaseDocType" NOT NULL,
    "doc_number" VARCHAR(30) NOT NULL,
    "doc_key" VARCHAR(30) NOT NULL,
    "issued_at" DATE NOT NULL,
    "prices_include_igv" BOOLEAN NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "igv" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "notes" VARCHAR(300),
    "status" "PurchaseStatus" NOT NULL DEFAULT 'RECEIVED',
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" INTEGER,
    "void_reason" VARCHAR(200),
    CONSTRAINT "purchases_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchases_clinic_id_number_key" ON "purchases"("clinic_id", "number");
CREATE INDEX "purchases_clinic_id_issued_at_idx" ON "purchases"("clinic_id", "issued_at");
CREATE INDEX "purchases_supplier_id_idx" ON "purchases"("supplier_id");
-- La misma ficha del mismo proveedor no se registra dos veces (las anuladas no cuentan)
CREATE UNIQUE INDEX "purchases_doc_unique" ON "purchases"("clinic_id", "supplier_id", "doc_type", "doc_key") WHERE "status" = 'RECEIVED';
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchases" ADD CONSTRAINT "purchases_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "product_batches" ADD COLUMN "supplier_id" INTEGER, ADD COLUMN "purchase_id" INTEGER;
CREATE INDEX "product_batches_supplier_id_idx" ON "product_batches"("supplier_id");
CREATE INDEX "product_batches_purchase_id_idx" ON "product_batches"("purchase_id");
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "product_batches" ADD CONSTRAINT "product_batches_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "purchase_lines" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "product_id" INTEGER NOT NULL,
    "presentation_id" INTEGER NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "description" VARCHAR(200) NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unit_price" DECIMAL(12,4) NOT NULL,
    "taxable" DECIMAL(12,2) NOT NULL,
    "igv" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    CONSTRAINT "purchase_lines_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_lines_batch_id_key" ON "purchase_lines"("batch_id");
CREATE INDEX "purchase_lines_purchase_id_idx" ON "purchase_lines"("purchase_id");
CREATE INDEX "purchase_lines_product_id_idx" ON "purchase_lines"("product_id");
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_lines" ADD CONSTRAINT "purchase_lines_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "product_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "purchase_files" (
    "id" SERIAL NOT NULL,
    "purchase_id" INTEGER NOT NULL,
    "mime" VARCHAR(40) NOT NULL,
    "size" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "purchase_files_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "purchase_files_purchase_id_key" ON "purchase_files"("purchase_id");
ALTER TABLE "purchase_files" ADD CONSTRAINT "purchase_files_purchase_id_fkey" FOREIGN KEY ("purchase_id") REFERENCES "purchases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "purchase_files" ADD CONSTRAINT "purchase_files_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Los proveedores que ya estaban escritos en los lotes pasan a la lista (uno por nombre parecido)
WITH named AS (
    SELECT "id", "clinic_id", btrim("supplier") AS "name",
           btrim(regexp_replace(lower(translate(btrim("supplier"), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g')) AS "key"
    FROM "product_batches"
    WHERE "supplier" IS NOT NULL AND btrim("supplier") <> ''
), picked AS (
    SELECT "clinic_id", "key", mode() WITHIN GROUP (ORDER BY "name") AS "name"
    FROM named WHERE "key" <> ''
    GROUP BY "clinic_id", "key"
)
INSERT INTO "suppliers" ("clinic_id", "name", "name_search", "updated_at")
SELECT "clinic_id", left("name", 150), left("key", 150), CURRENT_TIMESTAMP FROM picked;

UPDATE "product_batches" b
SET "supplier_id" = s."id"
FROM "suppliers" s
WHERE s."clinic_id" = b."clinic_id"
  AND b."supplier" IS NOT NULL
  AND s."name_search" = btrim(regexp_replace(lower(translate(btrim(b."supplier"), 'ÁÉÍÓÚÜÑáéíóúüñ', 'AEIOUUNaeiouun')), '[^a-z0-9]+', ' ', 'g'));
