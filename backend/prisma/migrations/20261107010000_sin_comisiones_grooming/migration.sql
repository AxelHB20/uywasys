-- El cliente no paga comisión a los groomers: se quita el porcentaje del usuario y el que se
-- congelaba en cada servicio entregado (el reporte de comisiones deja de existir).
ALTER TABLE "users" DROP COLUMN IF EXISTS "commission_percent";
ALTER TABLE "grooming_sessions" DROP COLUMN IF EXISTS "commission_percent";
