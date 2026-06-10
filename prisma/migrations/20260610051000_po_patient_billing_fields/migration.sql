-- PO field-persistence batch (2026-06-10): the facility create form collected
-- procedure/patient/billing/GL fields and per-line lot/serial numbers, then
-- silently discarded them on submit. All columns nullable — no backfill.
--
-- PHI note: patientMrn / patientInitials / procedureDate are facility-only.
-- Vendor read paths use an explicit select that excludes them.

-- AlterTable
ALTER TABLE "purchase_order"
  ADD COLUMN "procedureDate" DATE,
  ADD COLUMN "patientMrn" TEXT,
  ADD COLUMN "patientInitials" TEXT,
  ADD COLUMN "billToAddress" TEXT,
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "departmentCode" TEXT,
  ADD COLUMN "glCode" TEXT,
  ADD COLUMN "specialInstructions" TEXT,
  ADD COLUMN "notes" TEXT;

-- AlterTable
ALTER TABLE "po_line_item"
  ADD COLUMN "lotNumber" TEXT,
  ADD COLUMN "serialNumber" TEXT;
