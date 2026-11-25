-- Avisos antes de que algo se detenga: edad del token del PSE, cupo mensual de comprobantes
-- y vencimientos del plan del PSE, del dominio y del servidor.
ALTER TABLE "billing_settings"
  ADD COLUMN "token_updated_at" TIMESTAMPTZ(3),
  ADD COLUMN "monthly_quota" INTEGER,
  ADD COLUMN "plan_expires_on" DATE,
  ADD COLUMN "domain_expires_on" DATE,
  ADD COLUMN "server_expires_on" DATE;

-- Los tokens ya guardados cuentan desde el último cambio de la configuración
UPDATE "billing_settings" SET "token_updated_at" = "updated_at" WHERE "api_token_enc" IS NOT NULL;
