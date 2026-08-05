-- Persist the archived source document's storage key on payor contracts.
-- The extract route has always uploaded the original file; without this
-- column every payor upload orphaned its object immediately (storage
-- audit 2026-08-05).
ALTER TABLE "payor_contract" ADD COLUMN "s3Key" TEXT;
