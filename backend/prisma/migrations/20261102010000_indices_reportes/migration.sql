-- Fase 7 · revisión de rendimiento (medido con EXPLAIN ANALYZE sobre ~200 mil cargos).
-- Las tablas aún son chicas: CREATE INDEX normal toma milisegundos al desplegar.

-- Devolver el stock de un cargo anulado y el margen del período buscan los movimientos por su
-- referencia; sin este índice recorrían todo el kardex de la clínica (crece sin límite).
CREATE INDEX "stock_movements_clinic_id_ref_type_ref_id_idx" ON "stock_movements"("clinic_id", "ref_type", "ref_id");

-- Atenciones del período (reportes, inicio) por fecha de apertura.
CREATE INDEX "visits_clinic_id_opened_at_idx" ON "visits"("clinic_id", "opened_at");

-- Devoluciones del período (lo cobrado en reportes, inicio y caja del día).
CREATE INDEX "cash_movements_clinic_id_created_at_idx" ON "cash_movements"("clinic_id", "created_at");
