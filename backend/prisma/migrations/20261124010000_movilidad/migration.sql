-- Movilidad (recojo y entrega) en consultas y grooming, con precio libre por caso.
ALTER TABLE "care_services" ADD COLUMN "system_key" VARCHAR(20);
CREATE UNIQUE INDEX "care_services_clinic_id_system_key_key" ON "care_services"("clinic_id", "system_key");

ALTER TABLE "queue_entries"
  ADD COLUMN "transport" "GroomingTransport" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "transport_address" VARCHAR(200),
  ADD COLUMN "transport_price" DECIMAL(10,2),
  ADD COLUMN "transport_charge_id" INTEGER,
  ADD COLUMN "delivered_home_at" TIMESTAMPTZ(3),
  ADD COLUMN "delivered_home_by_id" INTEGER;
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_delivered_home_by_id_fkey"
  FOREIGN KEY ("delivered_home_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "appointments"
  ADD COLUMN "transport" "GroomingTransport" NOT NULL DEFAULT 'NONE',
  ADD COLUMN "transport_address" VARCHAR(200),
  ADD COLUMN "transport_price" DECIMAL(10,2);

ALTER TABLE "grooming_sessions" ADD COLUMN "transport_charge_id" INTEGER;
