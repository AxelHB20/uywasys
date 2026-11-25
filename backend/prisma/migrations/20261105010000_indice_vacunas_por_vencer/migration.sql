-- QA de rendimiento: "vacunas por vencer" (inicio y recordatorios) busca la última aplicación de cada
-- vacuna por mascota fila a fila con este índice, en vez de ordenar todo el historial de la clínica.
-- Con 3 años de datos (30 000 vacunas): 58,8 ms → 2,0 ms. Índice por expresión: Prisma no lo declara
-- en schema.prisma, vive solo en esta migración.
CREATE INDEX IF NOT EXISTS "immunizations_latest_idx"
  ON "immunizations" ("pet_id", "kind", lower("name"), "applied_at" DESC, "id" DESC)
  WHERE "voided_at" IS NULL;
