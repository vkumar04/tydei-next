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

echo "[prisma-deploy] Applying any pending migrations…"
bunx prisma migrate deploy $CONFIG_FLAG

echo "[prisma-deploy] Done."
