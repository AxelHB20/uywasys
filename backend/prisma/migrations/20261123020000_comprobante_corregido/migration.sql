-- Un comprobante rechazado por SUNAT deja de ser un problema cuando se emite otro para el mismo
-- cobro (corregido o cambiado a factura) o cuando el cobro se anula.
ALTER TABLE "electronic_documents" ADD COLUMN "replaced_at" TIMESTAMPTZ(3);

UPDATE "electronic_documents" d SET "replaced_at" = d."updated_at"
WHERE d."status" = 'REJECTED'
  AND d."type" IN ('BOLETA', 'FACTURA')
  AND d."receipt_id" IS NOT NULL
  AND (
    EXISTS (
      SELECT 1 FROM "electronic_documents" n
      WHERE n."receipt_id" = d."receipt_id" AND n."id" > d."id"
        AND n."type" IN ('BOLETA', 'FACTURA') AND n."status" <> 'REJECTED'
    )
    OR EXISTS (SELECT 1 FROM "receipts" r WHERE r."id" = d."receipt_id" AND r."status" = 'VOID')
  );
