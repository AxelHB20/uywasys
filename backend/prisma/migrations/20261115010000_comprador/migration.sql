-- Datos del comprador: la factura (o la boleta desde S/ 700) se completa en el mismo cobro.
-- Datos de facturación del cliente: el RUC al que factura (puede ser el de su empresa, distinto
-- de su DNI) y se proponen en el siguiente cobro.
ALTER TABLE "clients"
  ADD COLUMN "invoice_ruc" CHAR(11),
  ADD COLUMN "invoice_name" VARCHAR(150),
  ADD COLUMN "invoice_address" VARCHAR(200),
  ADD COLUMN "invoice_email" VARCHAR(120);
-- Correo del comprador en el comprobante: el PSE le envía el PDF
ALTER TABLE "electronic_documents" ADD COLUMN "customer_email" VARCHAR(120);
-- Token del servicio de consulta de RUC/DNI (APISPERU), cifrado como el del PSE
ALTER TABLE "billing_settings" ADD COLUMN "lookup_token_enc" TEXT;
