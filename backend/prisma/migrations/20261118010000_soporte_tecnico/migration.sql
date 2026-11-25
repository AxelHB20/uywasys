-- Cuenta de soporte técnico: única que cambia la configuración de facturación y el RUC.
-- Se marca a mano en el servidor (docs/FACTURACION.md); no se puede asignar desde la pantalla.
ALTER TABLE "users" ADD COLUMN "is_support" BOOLEAN NOT NULL DEFAULT false;
