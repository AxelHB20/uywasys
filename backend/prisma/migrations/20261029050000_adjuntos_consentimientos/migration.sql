-- Fase 5, paso 5: adjuntos y consentimientos informados

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('PHOTO', 'LAB', 'IMAGING', 'DOCUMENT');
CREATE TYPE "ConsentType" AS ENUM ('SURGERY', 'ANESTHESIA', 'EUTHANASIA', 'HOSPITALIZATION', 'OTHER');

-- CreateTable
CREATE TABLE "attachments" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "visit_id" INTEGER,
    "kind" "AttachmentKind" NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "file_name" VARCHAR(200) NOT NULL,
    "mime" VARCHAR(40) NOT NULL,
    "size" INTEGER NOT NULL,
    "created_by_id" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" INTEGER,
    "void_reason" VARCHAR(200),

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attachment_files" (
    "attachment_id" INTEGER NOT NULL,
    "data" BYTEA NOT NULL,

    CONSTRAINT "attachment_files_pkey" PRIMARY KEY ("attachment_id")
);

-- CreateTable
CREATE TABLE "consents" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "number" INTEGER NOT NULL,
    "pet_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "visit_id" INTEGER,
    "type" "ConsentType" NOT NULL,
    "procedure" VARCHAR(200) NOT NULL,
    "text" TEXT NOT NULL,
    "signer_name" VARCHAR(150) NOT NULL,
    "signer_document" VARCHAR(20),
    "signer_relation" VARCHAR(40) NOT NULL,
    "signature" BYTEA NOT NULL,
    "signed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vet_id" INTEGER NOT NULL,
    "hash" CHAR(64) NOT NULL,
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" INTEGER,
    "void_reason" VARCHAR(200),

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attachments_pet_id_created_at_idx" ON "attachments"("pet_id", "created_at");
CREATE INDEX "attachments_visit_id_idx" ON "attachments"("visit_id");
CREATE UNIQUE INDEX "consents_clinic_id_number_key" ON "consents"("clinic_id", "number");
CREATE INDEX "consents_pet_id_signed_at_idx" ON "consents"("pet_id", "signed_at");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "attachment_files" ADD CONSTRAINT "attachment_files_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "consents" ADD CONSTRAINT "consents_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consents" ADD CONSTRAINT "consents_pet_id_fkey" FOREIGN KEY ("pet_id") REFERENCES "pets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consents" ADD CONSTRAINT "consents_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consents" ADD CONSTRAINT "consents_visit_id_fkey" FOREIGN KEY ("visit_id") REFERENCES "visits"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "consents" ADD CONSTRAINT "consents_vet_id_fkey" FOREIGN KEY ("vet_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "consents" ADD CONSTRAINT "consents_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
