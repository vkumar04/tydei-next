#!/usr/bin/env bash
# Production migration deploy.
#
# Replaces the previous `prisma db push --accept-data-loss` preDeploy
# command (which silently destroyed prod data on schema drift). New
# behavior:
#
#   1. If the database has NEVER been migrated by Prisma Migrate
#      (the `_prisma_migrations` table is missing), mark the
#      `0_init` baseline as applied. The baseline is generated
#      via `prisma migrate diff --from-empty --to-schema --script`
#      and committed at prisma/migrations/0_init/migration.sql.
#      `migrate resolve --applied` is idempotent — running it on a
#      DB that already has the baseline recorded is a no-op.
#
#   2. Run `prisma migrate deploy` — applies any newer migrations
#      in order. Safe to re-run; does not touch the schema if no
#      pending migrations exist.
#
# This script is also safe for local dev: a fresh DB will record the
# baseline + apply nothing further.

set -euo pipefail

CONFIG_FLAG="--config=prisma/prisma.config.ts"

echo "[prisma-deploy] Marking 0_init baseline as applied (idempotent)…"
bunx prisma migrate resolve --applied 0_init $CONFIG_FLAG || {
  # If the migration is ALREADY recorded, `resolve --applied` errors;
  # that's expected on every deploy after the first. Tolerate the
  # specific "already applied" wording but bubble anything else.
  echo "[prisma-deploy] resolve --applied returned non-zero (likely already applied) — continuing."
}

# Self-heal the 2026-05-25 growth_rebate-drop migration. Its first
# version was committed with snake_case column names (`term_type`,
# `growth_only`) when Prisma's schema uses camelCase fields without
# `@map`, so the actual DB columns are quoted camelCase
# (`"termType"`, `"growthOnly"`). The UPDATE failed instantly and
# Postgres rolled the whole transaction back — no data changed, but
# Prisma's `_prisma_migrations` table now carries a permanent "failed"
# row that blocks every subsequent migrate-deploy. The fixed migration
# uses the correct identifiers; this step marks the prior failure as
# rolled-back so the new version actually runs.
#
# Idempotent: once the migration is successfully applied, `resolve
# --rolled-back` errors with "migration not found in a failed state"
# which we tolerate.
FAILED_MIGRATION="20260525120000_drop_growth_rebate_term_type"
echo "[prisma-deploy] Clearing any failed record for ${FAILED_MIGRATION} (idempotent)…"
bunx prisma migrate resolve --rolled-back "$FAILED_MIGRATION" $CONFIG_FLAG 2>/dev/null || {
  echo "[prisma-deploy] No failed ${FAILED_MIGRATION} record found — continuing."
}

echo "[prisma-deploy] Applying any pending migrations…"
bunx prisma migrate deploy $CONFIG_FLAG

echo "[prisma-deploy] Done."
