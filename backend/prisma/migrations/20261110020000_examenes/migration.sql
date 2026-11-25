-- Exámenes de laboratorio: pedido desde la atención, muestra, resultado y revisión del veterinario.
CREATE TYPE "LabOrderStatus" AS ENUM ('REQUESTED', 'SAMPLE_TAKEN', 'RESULT_READY', 'REVIEWED', 'CANCELLED');
CREATE TYPE "LabDestination" AS ENUM ('IN_HOUSE', 'EXTERNAL');

CREATE TABLE "lab_orders" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "visit_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'REQUESTED',
    "destination" "LabDestination" NOT NULL DEFAULT 'IN_HOUSE',
    "external_lab" VARCHAR(120),
    "lab_cost" DECIMAL(12,2),
    "indication" VARCHAR(300),
    "requested_by_id" INTEGER NOT NULL,
    "requested_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sample_at" TIMESTAMPTZ(3),
    "sample_by_id" INTEGER,
    "result_at" TIMESTAMPTZ(3),
    "result_by_id" INTEGER,
    "result_text" TEXT,
    "attachment_id" INTEGER,
    "reviewed_at" TIMESTAMPTZ(3),
    "reviewed_by_id" INTEGER,
    "interpretation" TEXT,
    "notified_at" TIMESTAMPTZ(3),
    "cancelled_at" TIMESTAMPTZ(3),
    "cancelled_by_id" INTEGER,
    "cancel_reason" VARCHAR(200),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "lab_orders_clinic_id_number_key" ON "lab_orders"("clinic_id", "number");
CREATE INDEX "lab_orders_clinic_id_status_idx" ON "lab_orders"("clinic_id", "status");
CREATE INDEX "lab_orders_visit_id_idx" ON "lab_orders"("visit_id");
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "lab_order_items" (
    "id" SERIAL NOT NULL,
    "lab_order_id" INTEGER NOT NULL,
    "care_service_id" INTEGER NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "charge_id" INTEGER,
    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "lab_order_items_lab_order_id_idx" ON "lab_order_items"("lab_order_id");
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_lab_order_id_fkey" FOREIGN KEY ("lab_order_id") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_care_service_id_fkey" FOREIGN KEY ("care_service_id") REFERENCES "care_services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
