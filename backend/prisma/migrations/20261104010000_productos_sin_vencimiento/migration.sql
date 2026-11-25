-- Productos que no vencen (camas, juguetes, correas): no piden lote ni vencimiento
ALTER TABLE "products" ADD COLUMN "tracks_expiry" BOOLEAN NOT NULL DEFAULT true;

UPDATE "products" SET "tracks_expiry" = false WHERE "category" = 'ACCESSORY';

-- Una fecha puesta por error en algo que no vence no debe marcarlo como vencido
UPDATE "product_batches" b SET "expires_at" = NULL
FROM "products" p
WHERE p."id" = b."product_id" AND p."tracks_expiry" = false;
