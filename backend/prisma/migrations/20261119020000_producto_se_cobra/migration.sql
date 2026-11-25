-- ¿Se cobra al cliente? Los insumos (jeringas, guantes…) se descuentan con el servicio o con
-- "insumos usados": no aparecen al cobrar salvo que la clínica lo encienda en ese producto.
ALTER TABLE "products" ADD COLUMN "chargeable" BOOLEAN NOT NULL DEFAULT true;
UPDATE "products" SET "chargeable" = false WHERE "category" = 'SUPPLY';
