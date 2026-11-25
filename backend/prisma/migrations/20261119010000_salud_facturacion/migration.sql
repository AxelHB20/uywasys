-- Salud de la conexión con el PSE: la revisa el servidor cada 6 h y cada envío
ALTER TABLE "billing_settings"
  ADD COLUMN "health" VARCHAR(12),
  ADD COLUMN "health_error" VARCHAR(500),
  ADD COLUMN "health_since" TIMESTAMPTZ(3),
  ADD COLUMN "health_checked_at" TIMESTAMPTZ(3),
  ADD COLUMN "health_failures" INTEGER NOT NULL DEFAULT 0;

-- Por qué falló el último envío: auth, suspended o network se reenvían solos al recuperarse
ALTER TABLE "electronic_documents" ADD COLUMN "error_kind" VARCHAR(12);
