-- #1 (Vick 2026-05-31): per-facility vendor name mappings.
-- VendorNameMapping was previously global and engine-unused; make it
-- per-facility so a confirmed "old name -> vendor" rule scopes to one
-- facility and the import resolver can consult it deterministically.
-- The table is empty at migration time, so the required column is safe.
ALTER TABLE "vendor_name_mapping" ADD COLUMN "facilityId" TEXT NOT NULL;

CREATE UNIQUE INDEX "vendor_name_mapping_facilityId_cogVendorName_key" ON "vendor_name_mapping"("facilityId", "cogVendorName");

ALTER TABLE "vendor_name_mapping" ADD CONSTRAINT "vendor_name_mapping_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "facility"("id") ON DELETE CASCADE ON UPDATE CASCADE;
