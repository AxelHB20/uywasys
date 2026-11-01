-- CreateEnum
CREATE TYPE "BillingProvider" AS ENUM ('SIMULATED', 'NUBEFACT');

-- CreateEnum
CREATE TYPE "ElectronicDocumentType" AS ENUM ('BOLETA', 'FACTURA', 'CREDIT_NOTE');

-- CreateEnum
CREATE TYPE "ElectronicDocumentStatus" AS ENUM ('PENDING', 'SENT', 'ACCEPTED', 'REJECTED', 'ERROR');

-- CreateTable
CREATE TABLE "billing_settings" (
    "clinic_id" INTEGER NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "provider" "BillingProvider" NOT NULL DEFAULT 'SIMULATED',
    "production" BOOLEAN NOT NULL DEFAULT false,
    "legal_name" VARCHAR(150),
    "api_url" VARCHAR(300),
    "api_token_enc" TEXT,
    "boleta_series" CHAR(4) NOT NULL DEFAULT 'B001',
    "factura_series" CHAR(4) NOT NULL DEFAULT 'F001',
    "boleta_credit_series" CHAR(4) NOT NULL DEFAULT 'BC01',
    "factura_credit_series" CHAR(4) NOT NULL DEFAULT 'FC01',
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "billing_settings_pkey" PRIMARY KEY ("clinic_id")
);

-- CreateTable
CREATE TABLE "electronic_documents" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "receipt_id" INTEGER,
    "type" "ElectronicDocumentType" NOT NULL,
    "series" CHAR(4) NOT NULL,
    "number" INTEGER NOT NULL,
    "issue_date" DATE NOT NULL,
    "customer_doc_type" VARCHAR(1) NOT NULL,
    "customer_doc_number" VARCHAR(15) NOT NULL,
    "customer_name" VARCHAR(150) NOT NULL,
    "customer_address" VARCHAR(200),
    "taxed_amount" DECIMAL(12,2) NOT NULL,
    "exempt_amount" DECIMAL(12,2) NOT NULL,
    "unaffected_amount" DECIMAL(12,2) NOT NULL,
    "igv_amount" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "items" JSONB NOT NULL,
    "related_id" INTEGER,
    "reason" VARCHAR(200),
    "provider" "BillingProvider" NOT NULL,
    "status" "ElectronicDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "last_error" VARCHAR(500),
    "sunat_description" VARCHAR(500),
    "hash" VARCHAR(100),
    "qr_text" VARCHAR(500),
    "pdf_url" VARCHAR(500),
    "xml_url" VARCHAR(500),
    "cdr_url" VARCHAR(500),
    "sent_at" TIMESTAMPTZ(3),
    "accepted_at" TIMESTAMPTZ(3),
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "electronic_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "electronic_documents_clinic_id_issue_date_idx" ON "electronic_documents"("clinic_id", "issue_date");

-- CreateIndex
CREATE INDEX "electronic_documents_status_next_attempt_at_idx" ON "electronic_documents"("status", "next_attempt_at");

-- CreateIndex
CREATE INDEX "electronic_documents_receipt_id_idx" ON "electronic_documents"("receipt_id");

-- CreateIndex
CREATE INDEX "electronic_documents_related_id_idx" ON "electronic_documents"("related_id");

-- CreateIndex
CREATE UNIQUE INDEX "electronic_documents_clinic_id_series_number_key" ON "electronic_documents"("clinic_id", "series", "number");

-- AddForeignKey
ALTER TABLE "billing_settings" ADD CONSTRAINT "billing_settings_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_documents" ADD CONSTRAINT "electronic_documents_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_documents" ADD CONSTRAINT "electronic_documents_receipt_id_fkey" FOREIGN KEY ("receipt_id") REFERENCES "receipts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_documents" ADD CONSTRAINT "electronic_documents_related_id_fkey" FOREIGN KEY ("related_id") REFERENCES "electronic_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "electronic_documents" ADD CONSTRAINT "electronic_documents_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
