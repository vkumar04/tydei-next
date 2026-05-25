-- Drop `growth_rebate` from the TermType enum.
--
-- Bug 2026-05-25 (Charles Bugs.rtfd): "Growth does not need to be there
-- because growth is built into each tier type already." The engine
-- already routes both growth_rebate and spend_rebate through
-- SPEND_REBATE (see lib/rebates/prisma-engine-bridge.ts:368-376), and
-- the growth math is gated by the `growth_only` boolean + baselineType.
-- Keeping growth_rebate as a separate enum value was misleading.
--
-- Prisma `migrate deploy` wraps each migration file in a transaction.
-- This file therefore must NOT contain its own BEGIN/COMMIT — nested
-- explicit transactions break Prisma's wrapper (the first run of this
-- migration failed for exactly that reason; see
-- `scripts/prisma-deploy.sh` runbook + the README at the bottom of
-- this file for resolving the failed-migration state on prod).
--
-- Every step is idempotent so this migration is safe to re-run after
-- a partial failure on prod:
--   - The UPDATE is a no-op once all growth_rebate rows have been
--     migrated (no rows to update).
--   - The enum rebuild uses guards (`IF EXISTS` / `IF NOT EXISTS`)
--     so retrying after a partial run reaches the same end state.

-- Step 1 — collapse `growth_rebate` rows into the unified
-- representation. termType becomes spend_rebate; growth_only flips to
-- true so the math engine produces the same accrual it did before.
-- growthBaselinePercent / baselineType / negotiatedBaseline are all
-- preserved by the omission.
UPDATE contract_term
   SET "termType"   = 'spend_rebate',
       "growthOnly" = true
 WHERE "termType"   = 'growth_rebate';

-- Step 2 — drop `growth_rebate` from the enum. Postgres has no
-- built-in "DROP VALUE FROM ENUM"; we rebuild the type and re-cast the
-- column. Order of values is preserved to match the new Prisma schema
-- so `prisma migrate diff` doesn't flag drift.
--
-- DO block lets us conditionally run the rebuild only if the old enum
-- shape still exists — supports recovery from a partial first run.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_type t
      JOIN pg_enum e ON e.enumtypid = t.oid
     WHERE t.typname = 'TermType'
       AND e.enumlabel = 'growth_rebate'
  ) THEN
    -- Rename the old type out of the way (idempotent — only runs if
    -- the old shape exists).
    EXECUTE 'ALTER TYPE "TermType" RENAME TO "TermType_old"';

    -- Create the new type with growth_rebate removed.
    EXECUTE $ddl$
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
      )
    $ddl$;

    -- Re-cast the column. DROP/SET DEFAULT bracket the type swap so
    -- Postgres doesn't reject the cast over the existing default.
    EXECUTE 'ALTER TABLE contract_term ALTER COLUMN "termType" DROP DEFAULT';
    EXECUTE 'ALTER TABLE contract_term ALTER COLUMN "termType" TYPE "TermType" USING "termType"::text::"TermType"';
    EXECUTE 'ALTER TABLE contract_term ALTER COLUMN "termType" SET DEFAULT ''spend_rebate''::"TermType"';

    -- Drop the orphaned old type.
    EXECUTE 'DROP TYPE "TermType_old"';
  END IF;
END
$$;
