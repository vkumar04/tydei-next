#!/usr/bin/env bash
# Production migration deploy.
#
# Replaces the previous `prisma db push --accept-data-loss` preDeploy
# command (which silently destroyed prod data on schema drift). New
# behavior:
#
#   1. If the database has tables but was NEVER migrated by Prisma
#      Migrate (the `_prisma_migrations` table is missing), mark the
#      `0_init` baseline as applied. An empty database skips this and
#      gets every migration, 0_init included, from step 2. The baseline
#      is generated via `prisma migrate diff --from-empty --to-schema
#      --script` and committed at prisma/migrations/0_init/migration.sql.
#
#   2. Run `prisma migrate deploy` — applies any newer migrations
#      in order. Safe to re-run; does not touch the schema if no
#      pending migrations exist.
#

set -euo pipefail

CONFIG_FLAG="--config=prisma/prisma.config.ts"

NEEDS_BASELINE=$(bun -e '
import pg from "pg"
const client = new pg.Client({ connectionString: process.env.DATABASE_URL })
await client.connect()
const { rows } = await client.query(`
  select to_regclass($$public._prisma_migrations$$) is not null as has_ledger,
         (select count(*)::int from information_schema.tables where table_schema = $$public$$) as tables`)
await client.end()
console.log(!rows[0].has_ledger && rows[0].tables > 0 ? "yes" : "no")
')

if [ "$NEEDS_BASELINE" = "yes" ]; then
  echo "[prisma-deploy] Pre-migrate database detected — marking 0_init baseline as applied…"
  bunx prisma migrate resolve --applied 0_init $CONFIG_FLAG
else
  echo "[prisma-deploy] Baseline not needed (ledger present or database empty)."
fi

# Self-heal the 2026-05-25 growth_rebate-drop migration. Its first
# version was committed with snake_case column names (`term_type`,
# `growth_only`) when Prisma's schema uses camelCase fields without
# `@map`, so the actual DB columns are quoted camelCase
# (`"termType"`, `"growthOnly"`). The UPDATE failed instantly and
# Postgres rolled the whole transaction back — no data changed, but
# Prisma's `_prisma_migrations` table carried a permanent "failed"
# row. RESOLVED 2026-06-09: the stale rolled-back ledger row was
# deleted from prod (the migration's successful second application
# remains recorded), so the per-deploy `migrate resolve --rolled-back`
# self-heal step is no longer needed and was removed. If a future
# migration fails mid-deploy, follow the same runbook: fix the SQL,
# `migrate resolve --rolled-back <name>` ONCE, redeploy.

echo "[prisma-deploy] Applying any pending migrations…"
bunx prisma migrate deploy $CONFIG_FLAG

echo "[prisma-deploy] Done."
