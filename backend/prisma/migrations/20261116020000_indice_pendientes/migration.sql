-- Caja → "Por cobrar": recorría todos los cargos de todas las clínicas (106 mil en la base de
-- volumen) para hallar los pendientes. Índice parcial solo con los pendientes: es diminuto
-- (los cargos se pagan pronto) y no pesa al cobrar. En frío bajó de ~1,5 s; en caliente
-- el recorrido de cargos pasó de 8 ms a 2,5 ms.
CREATE INDEX "charges_pending_idx" ON "charges" ("clinic_id", "client_id") WHERE "status" = 'PENDING';
