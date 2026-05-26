-- AlterTable
ALTER TABLE "contract" ADD COLUMN "additionalVendorIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
