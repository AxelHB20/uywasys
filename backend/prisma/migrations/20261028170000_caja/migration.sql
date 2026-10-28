-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'YAPE', 'PLIN', 'CARD', 'TRANSFER');

-- CreateEnum
CREATE TYPE "CashSessionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "ReceiptStatus" AS ENUM ('ACTIVE', 'VOID');

-- CreateEnum
CREATE TYPE "CashMovementKind" AS ENUM ('EXPENSE', 'REFUND');

-- AlterTable
ALTER TABLE "charges" ADD COLUMN     "paid_amount" DECIMAL(12,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "clients" ADD COLUMN     "walk_in" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "cash_registers" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "name" VARCHAR(60) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_registers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_sessions" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "register_id" INTEGER NOT NULL,
    "status" "CashSessionStatus" NOT NULL DEFAULT 'OPEN',
    "opening_amount" DECIMAL(12,2) NOT NULL,
    "opened_by_id" INTEGER NOT NULL,
    "opened_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_by_id" INTEGER,
    "closed_at" TIMESTAMPTZ(3),
    "expected_cash" DECIMAL(12,2),
    "counted_cash" DECIMAL(12,2),
    "difference" DECIMAL(12,2),
    "closing_note" VARCHAR(200),

    CONSTRAINT "cash_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receipts" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "change" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "request_key" VARCHAR(64) NOT NULL,
    "status" "ReceiptStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_id" INTEGER,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(200),

    CONSTRAINT "receipts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "tendered" DECIMAL(12,2),
    "operation_code" VARCHAR(40),

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_allocations" (
    "id" SERIAL NOT NULL,
    "receipt_id" INTEGER NOT NULL,
    "charge_id" INTEGER NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "session_id" INTEGER NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'CASH',
    "amount" DECIMAL(12,2) NOT NULL,
    "reason" VARCHAR(200) NOT NULL,
    "receipt_id" INTEGER,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_by_id" INTEGER,
    "voided_at" TIMESTAMPTZ(3),
    "void_reason" VARCHAR(200),

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_registers_clinic_id_name_key" ON "cash_registers"("clinic_id", "name");

-- CreateIndex
CREATE INDEX "cash_sessions_register_id_status_idx" ON "cash_sessions"("register_id", "status");

-- CreateIndex
CREATE INDEX "cash_sessions_clinic_id_opened_at_idx" ON "cash_sessions"("clinic_id", "opened_at");

-- CreateIndex
CREATE INDEX "receipts_session_id_idx" ON "receipts"("session_id");

-- CreateIndex
CREATE INDEX "receipts_client_id_idx" ON "receipts"("client_id");

-- CreateIndex
CREATE INDEX "receipts_clinic_id_created_at_idx" ON "receipts"("clinic_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_clinic_id_number_key" ON "receipts"("clinic_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receipts_clinic_id_request_key_key" ON "receipts"("clinic_id", "request_key");

-- CreateIndex
CREATE INDEX "payments_receipt_id_idx" ON "payments"("receipt_id");

-- CreateIndex
CREATE INDEX "payment_allocations_receipt_id_idx" ON "payment_allocations"("receipt_id");

-- CreateIndex
CREATE INDEX "payment_allocations_charge_id_idx" ON "payment_allocations"("charge_id");

-- CreateIndex
CREATE INDEX "cash_movements_session_id_idx" ON "cash_movements"("session_id");

-- CreateIndex
CREATE INDEX "cash_movements_receipt_id_idx" ON "cash_movements"("receipt_id");

-- AddForeignKey
ALTER TABLE "cash_registers" ADD CONSTRAINT "cash_registers_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "cash_registers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_opened_by_id_fkey" FOREIGN KEY ("opened_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_sessions" ADD CONSTRAINT "cash_sessions_closed_by_id_fkey" FOREIGN KEY ("closed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_allocations" ADD CONSTRAINT "payment_allocations_charge_id_fkey" FOREIGN KEY ("charge_id") REFERENCES "charges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "cash_sessions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cada clínica existente empieza con su "Caja principal"
INSERT INTO "cash_registers" ("clinic_id", "name") SELECT "id", 'Caja principal' FROM "clinics";
