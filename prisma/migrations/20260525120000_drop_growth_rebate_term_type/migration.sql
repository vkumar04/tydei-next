-- Drop `growth_rebate` from the TermType enum.
--
-- Bug 2026-05-25 (Charles Bugs.rtfd): "Growth does not need to be there
-- because growth is built into each tier type already." The engine
-- already routes both growth_rebate and spend_rebate through
-- SPEND_REBATE (see lib/rebates/prisma-engine-bridge.ts:368-376), and
-- the growth math is gated by the `growth_only` boolean + baselineType.
-- Keeping growth_rebate as a separate enum value was misleading.
--
-- Migration is wrapped in a single transaction. If any step fails the
-- whole thing rolls back — production data is never left half-migrated.

BEGIN;

-- Step 1: collapse `growth_rebate` rows into the unified representation.
--         termType becomes spend_rebate; growth_only flips to true so
--         the math engine produces the same accrual it did before.
--         growthBaselinePercent / baselineType / negotiatedBaseline are
--         all preserved by the omission.
UPDATE contract_term
   SET term_type    = 'spend_rebate',
       growth_only  = true
 WHERE term_type    = 'growth_rebate';

-- Step 2: drop `growth_rebate` from the enum. Postgres has no built-in
--         "DROP VALUE FROM ENUM"; we rebuild the type and re-cast the
--         column. Order of values is preserved to match the new Prisma
--         schema (otherwise `prisma migrate diff` will flag a drift on
--         the next deploy).
ALTER TYPE "TermType" RENAME TO "TermType_old";

CREATE TYPE "TermType" AS ENUM (
  'spend_rebate',
  'volume_rebate',
  'price_reduction',
  'market_share',
  'market_share_price_reduction',
  'capitated_price_reduction',
  'capitated_pricing_rebate',
  'po_rebate',
  'carve_out',
  'payment_rebate',
  'compliance_rebate',
  'fixed_fee',
  'locked_pricing',
  'rebate_per_use'
);

ALTER TABLE contract_term
  ALTER COLUMN term_type DROP DEFAULT,
  ALTER COLUMN term_type TYPE "TermType" USING term_type::text::"TermType",
  ALTER COLUMN term_type SET DEFAULT 'spend_rebate'::"TermType";

DROP TYPE "TermType_old";

COMMIT;
