-- M7 (2026-06-09 audit): poNumber had no uniqueness at all — two count-based
-- create paths (facility numbered per-facility, vendor numbered per-VENDOR)
-- could mint duplicate PO numbers within the same facility. Uniqueness is
-- per-facility; both create paths now count by facilityId and retry on
-- P2002 collisions.
--
-- Precondition: existing (facilityId, poNumber) pairs must be distinct.
-- If legacy vendor-numbered rows collide, renumber them before applying.

-- CreateIndex
CREATE UNIQUE INDEX "purchase_order_facilityId_poNumber_key" ON "purchase_order"("facilityId", "poNumber");
