-- Hospitalización: alta voluntaria y "cobrar aparte" en cada indicación (opcional)
ALTER TABLE "hospitalizations" ADD COLUMN "voluntary" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "hospitalization_orders" ADD COLUMN "care_service_id" INTEGER;
ALTER TABLE "hospitalization_orders" ADD COLUMN "product_id" INTEGER;
ALTER TABLE "hospitalization_orders" ADD COLUMN "presentation_id" INTEGER;

ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_care_service_id_fkey" FOREIGN KEY ("care_service_id") REFERENCES "care_services"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "hospitalization_orders" ADD CONSTRAINT "hospitalization_orders_presentation_id_fkey" FOREIGN KEY ("presentation_id") REFERENCES "product_presentations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
