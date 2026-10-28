-- Correlativos por clínica: los clientes y mascotas existentes se numeran en el orden en que se crearon.

-- AlterTable
ALTER TABLE "clients" ADD COLUMN "number" INTEGER;

-- AlterTable
ALTER TABLE "pets" ADD COLUMN "number" INTEGER;

-- Numerar lo que ya existe
UPDATE "clients" AS c SET "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "clinic_id" ORDER BY "id") AS rn FROM "clients") AS n
WHERE c."id" = n."id";

UPDATE "pets" AS p SET "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "clinic_id" ORDER BY "id") AS rn FROM "pets") AS n
WHERE p."id" = n."id";

ALTER TABLE "clients" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "pets" ALTER COLUMN "number" SET NOT NULL;

-- CreateTable
CREATE TABLE "clinic_sequences" (
    "clinic_id" INTEGER NOT NULL,
    "key" VARCHAR(30) NOT NULL,
    "last_value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "clinic_sequences_pkey" PRIMARY KEY ("clinic_id","key")
);

-- Los contadores siguen desde el último número asignado
INSERT INTO "clinic_sequences" ("clinic_id", "key", "last_value")
SELECT "clinic_id", 'client', MAX("number") FROM "clients" GROUP BY "clinic_id";

INSERT INTO "clinic_sequences" ("clinic_id", "key", "last_value")
SELECT "clinic_id", 'pet', MAX("number") FROM "pets" GROUP BY "clinic_id";

-- CreateIndex
CREATE UNIQUE INDEX "clients_clinic_id_number_key" ON "clients"("clinic_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "pets_clinic_id_number_key" ON "pets"("clinic_id", "number");

-- AddForeignKey
ALTER TABLE "clinic_sequences" ADD CONSTRAINT "clinic_sequences_clinic_id_fkey" FOREIGN KEY ("clinic_id") REFERENCES "clinics"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
