-- Descuento en caja: quién lo dio (antes era siempre quien registró el cargo)
ALTER TABLE "charges" ADD COLUMN "discount_by_id" INTEGER;
UPDATE "charges" SET "discount_by_id" = "created_by_id" WHERE "discount" > 0;
