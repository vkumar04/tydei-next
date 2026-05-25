-- Add `stripeCustomerId` to the User table.
--
-- The @better-auth/stripe plugin contributes a `stripeCustomerId`
-- field to the User entity it joins on every sign-in. Without the
-- column, enabling better-auth's `experimental.joins` produces:
--   "Unknown field `stripeCustomerId` for select statement on model
--    `User`"
-- and every sign-in 500s (root cause of today's revert: d9a161a).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS so re-running on a database
-- where the column already exists (e.g. a hand-applied dev box) is
-- a no-op. The unique index follows the same guard convention.

ALTER TABLE "user"
  ADD COLUMN IF NOT EXISTS "stripeCustomerId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "user_stripeCustomerId_key"
  ON "user"("stripeCustomerId");
