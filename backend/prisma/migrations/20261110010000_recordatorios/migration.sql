-- Recordatorios gratis: portal sin carnet por defecto, avisos al celular del dueño y registro de
-- a quién ya se avisó (WhatsApp desde recepción o notificación automática).
ALTER TABLE "clinics" ADD COLUMN "portal_show_records" BOOLEAN NOT NULL DEFAULT false;

CREATE TYPE "ReminderKind" AS ENUM ('VACCINE', 'APPOINTMENT');
CREATE TYPE "ReminderChannel" AS ENUM ('WHATSAPP', 'PUSH');

CREATE TABLE "push_subscriptions" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "client_id" INTEGER NOT NULL,
    "portal_link_id" INTEGER NOT NULL,
    "endpoint" VARCHAR(1000) NOT NULL,
    "p256dh" VARCHAR(200) NOT NULL,
    "auth" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_sent_at" TIMESTAMPTZ(3),
    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");
CREATE INDEX "push_subscriptions_clinic_id_client_id_idx" ON "push_subscriptions"("clinic_id", "client_id");
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_portal_link_id_fkey"
  FOREIGN KEY ("portal_link_id") REFERENCES "portal_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reminder_logs" (
    "id" SERIAL NOT NULL,
    "clinic_id" INTEGER NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "target_id" INTEGER NOT NULL,
    "channel" "ReminderChannel" NOT NULL,
    "sent_by_id" INTEGER,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_logs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reminder_logs_kind_target_id_channel_key" ON "reminder_logs"("kind", "target_id", "channel");
CREATE INDEX "reminder_logs_clinic_id_sent_at_idx" ON "reminder_logs"("clinic_id", "sent_at");

CREATE TABLE "system_settings" (
    "key" VARCHAR(60) NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("key")
);
