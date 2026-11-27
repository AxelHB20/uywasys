-- Unidad mínima "caja" y "frasco": productos que se venden enteros (no por ml ni por unidad suelta).
-- Solo agrega valores al enum; no cambia datos.
ALTER TYPE "BaseUnit" ADD VALUE IF NOT EXISTS 'BOX';
ALTER TYPE "BaseUnit" ADD VALUE IF NOT EXISTS 'BOTTLE';
