-- Vendor names must be unique.
--
-- Charles 2026-07-28: the catalog had no uniqueness at all, so two rows could
-- carry the identical name. Verified safe to apply: 0 duplicate names on the
-- production snapshot (200 vendors) and 0 on the dev seed, at exact, lower(), and
-- lower(trim()) comparison. If a future environment DOES hold duplicates this
-- migration will fail loudly rather than silently merging them — which is the
-- correct outcome, since choosing which row survives is a data decision.
CREATE UNIQUE INDEX "vendor_name_key" ON "vendor"("name");
