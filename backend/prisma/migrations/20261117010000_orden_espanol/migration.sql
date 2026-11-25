-- Orden alfabético en español en las listas: con la intercalación por defecto (C.UTF-8)
-- "Álvaro" quedaba después de "Zoe" y "César" después de "Cliente". "es-x-icu" ordena
-- Á junto a A y ñ después de n. Es determinista: la igualdad y los índices únicos no cambian.
-- Los índices sobre estas columnas se reconstruyen solos con el ALTER.
ALTER TABLE "clients"            ALTER COLUMN "name"      TYPE VARCHAR(150) COLLATE "es-x-icu";
ALTER TABLE "pets"               ALTER COLUMN "name"      TYPE VARCHAR(60)  COLLATE "es-x-icu";
ALTER TABLE "products"           ALTER COLUMN "name"      TYPE VARCHAR(120) COLLATE "es-x-icu";
ALTER TABLE "care_services"      ALTER COLUMN "name"      TYPE VARCHAR(120) COLLATE "es-x-icu";
ALTER TABLE "users"              ALTER COLUMN "full_name" TYPE VARCHAR(120) COLLATE "es-x-icu";
ALTER TABLE "suppliers"          ALTER COLUMN "name"      TYPE VARCHAR(150) COLLATE "es-x-icu";
ALTER TABLE "clinical_templates" ALTER COLUMN "name"      TYPE VARCHAR(80)  COLLATE "es-x-icu";
