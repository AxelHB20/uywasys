/*
  Warnings:

  - You are about to drop the column `logo_url` on the `clinics` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "clinics" DROP COLUMN "logo_url",
ADD COLUMN     "logo" BYTEA,
ADD COLUMN     "logo_mime" VARCHAR(20),
ADD COLUMN     "logo_updated_at" TIMESTAMPTZ(3);

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false;
