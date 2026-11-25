-- Búsqueda de RUC/DNI en el cobro (GET /api/billing/lookup): sin estos índices recorría todos los
-- clientes y todos los comprobantes en cada RUC nuevo (medido: 4,7 ms con 49 mil comprobantes,
-- crece con los años; en frío, cientos de ms). Con índice: < 0,1 ms.
-- Sin CONCURRENTLY: Prisma envía la migración en un solo bloque; las tablas aún son chicas.
CREATE INDEX "clients_clinic_id_invoice_ruc_idx" ON "clients" ("clinic_id", "invoice_ruc");
CREATE INDEX "electronic_documents_customer_doc_idx"
  ON "electronic_documents" ("clinic_id", "customer_doc_type", "customer_doc_number");
