-- Centro de notificaciones: hasta cuándo vio cada usuario sus avisos (no leídas en cualquier equipo)
ALTER TABLE "users" ADD COLUMN "notifications_seen_at" TIMESTAMPTZ(3);
