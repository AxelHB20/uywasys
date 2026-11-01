-- Fase 6, paso 3: comisiones de grooming. El porcentaje del groomer se congela al entregar,
-- así cambiarlo después no altera lo que ya se ganó.
ALTER TABLE "grooming_sessions" ADD COLUMN "commission_percent" DECIMAL(5,2);
