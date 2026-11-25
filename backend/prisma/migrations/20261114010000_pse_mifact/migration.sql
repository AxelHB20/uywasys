-- Mifact (Osys Company S.A.C., PSE autorizado) como proveedor de facturación electrónica.
-- Mifact exige en cada comprobante la dirección fiscal y el ubigeo del emisor.
ALTER TYPE "BillingProvider" ADD VALUE 'MIFACT';
ALTER TABLE "billing_settings"
  ADD COLUMN "fiscal_address" VARCHAR(200),
  ADD COLUMN "ubigeo" CHAR(6);
