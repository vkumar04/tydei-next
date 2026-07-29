#!/usr/bin/env bash
#
# Refresh the local read-only snapshot of the production database.
#
# WHY THIS EXISTS. The snapshot is what we check "is this bug actually firing?"
# against — a cap of 500 rows only matters if some tenant really holds more than
# 500. There was no script for this, so the container just sat there, and on
# 2026-07-28 a 46-hour-old snapshot produced a wrong answer: it still held 674
# case records that a user had since deleted in prod, so a latent row cap got
# reported as firing in production. A snapshot with no visible age is worse than
# no snapshot, because it looks like evidence.
#
# This is READ-ONLY against production: pg_dump only. Nothing here writes to
# prod. The local container is destroyed and rebuilt, so never put anything in
# it you want to keep.
#
# Usage:
#   bash scripts/refresh-prod-snapshot.sh          # refresh if stale (>24h) or missing
#   bash scripts/refresh-prod-snapshot.sh --force  # always refresh
#   bash scripts/refresh-prod-snapshot.sh --check  # report age only, change nothing
#
set -euo pipefail

CONTAINER=tydei-prod-snapshot
HOST_PORT=5436
PG_IMAGE=postgres:18-alpine   # must be >= the prod server major (18.x as of 2026-07)
SNAP_USER=snap
SNAP_DB=tydei_snapshot
MAX_AGE_HOURS=24
DUMP_DIR="${TMPDIR:-/tmp}/tydei-snapshot"

MODE="${1:-}"

note() { printf '\033[36m│\033[0m %s\n' "$*"; }
ok()   { printf '\033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '\033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\033[31m✗\033[0m %s\n' "$*" >&2; exit 1; }

# ── How old is what we have? ────────────────────────────────────────────────
# Age is taken from the container's creation time rather than a file we write,
# so it cannot drift out of sync with the thing it describes.
snapshot_age_hours() {
  local created
  created=$(docker inspect "$CONTAINER" --format '{{.Created}}' 2>/dev/null) || return 1
  local created_epoch now_epoch
  # `.Created` is RFC3339 in UTC. Both branches must be told that: without -u
  # the timestamp is read as local time, which UNDER-reports the age by the
  # UTC offset (4h on US Eastern) and can wave a stale snapshot past the gate.
  created_epoch=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "${created:0:19}" +%s 2>/dev/null \
    || date -u -d "${created:0:19}" +%s 2>/dev/null) || return 1
  now_epoch=$(date +%s)
  echo $(( (now_epoch - created_epoch) / 3600 ))
}

AGE=$(snapshot_age_hours || echo "")

if [ -n "$AGE" ]; then
  note "existing snapshot is ${AGE}h old"
else
  note "no snapshot container present"
fi

if [ "$MODE" = "--check" ]; then
  [ -z "$AGE" ] && { warn "absent — run without --check to create it"; exit 1; }
  if [ "$AGE" -gt "$MAX_AGE_HOURS" ]; then
    warn "STALE (>${MAX_AGE_HOURS}h). Do not trust row counts from it."
    exit 1
  fi
  ok "fresh"
  exit 0
fi

if [ -n "$AGE" ] && [ "$AGE" -le "$MAX_AGE_HOURS" ] && [ "$MODE" != "--force" ]; then
  ok "snapshot is ${AGE}h old (< ${MAX_AGE_HOURS}h) — nothing to do. Use --force to refresh anyway."
  exit 0
fi

# ── Pull the prod connection string from Railway ────────────────────────────
# DATABASE_PUBLIC_URL, not DATABASE_URL: the latter resolves to
# postgres.railway.internal, which only exists inside Railway's network.
command -v railway >/dev/null || die "railway CLI not found (npm i -g @railway/cli)"
note "reading prod connection string from Railway…"
PROD_URL=$(railway variables --service Postgres --json 2>/dev/null \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["DATABASE_PUBLIC_URL"])') \
  || die "could not read DATABASE_PUBLIC_URL — are you linked? try: railway link"
[ -n "$PROD_URL" ] || die "DATABASE_PUBLIC_URL was empty"

# ── Dump (read-only against prod) ───────────────────────────────────────────
mkdir -p "$DUMP_DIR"
DUMP="$DUMP_DIR/prod-$(date +%Y%m%d-%H%M).dump"
note "dumping production (read-only)…"
docker run --rm "$PG_IMAGE" pg_dump --no-owner --no-acl -Fc "$PROD_URL" > "$DUMP" \
  || die "pg_dump failed"
[ -s "$DUMP" ] || die "dump is empty — refusing to replace a working snapshot with nothing"
ok "dumped $(du -h "$DUMP" | cut -f1)"

# ── Restore into a NEW container, and only swap once it succeeds ────────────
# The old snapshot stays up throughout. A half-restored container that still
# answers queries is the exact failure this ordering prevents.
#
# The data lives on a named volume rather than the container's own filesystem so
# the final container can be created fresh with the published port. `docker
# rename` cannot add a port mapping, and the postgres image declares its data
# path as a VOLUME, so `docker commit` would silently capture an empty data
# directory — both routes lose the restore.
#
# MOUNT AT /var/lib/postgresql, NOT /var/lib/postgresql/data. Postgres 18 moved
# PGDATA to /var/lib/postgresql/18/docker and declares the VOLUME one level up;
# mounting the pre-18 .../data path makes the container refuse to start with a
# "suggested container configuration for 18+" notice and exit. Keep this in step
# with PG_IMAGE if it is ever pinned back to 17 or earlier, where .../data is
# correct.
STAGING="${CONTAINER}-staging"
VOLUME="tydei-snapshot-$(date +%Y%m%d%H%M%S)"
docker rm -f "$STAGING" >/dev/null 2>&1 || true
note "starting staging container…"
docker volume create "$VOLUME" >/dev/null
docker run -d --name "$STAGING" -v "$VOLUME:/var/lib/postgresql" \
  -e POSTGRES_PASSWORD="$SNAP_USER" -e POSTGRES_USER="$SNAP_USER" -e POSTGRES_DB="$SNAP_DB" \
  "$PG_IMAGE" >/dev/null

for _ in $(seq 1 60); do
  docker exec "$STAGING" pg_isready -U "$SNAP_USER" -d "$SNAP_DB" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$STAGING" pg_isready -U "$SNAP_USER" -d "$SNAP_DB" >/dev/null 2>&1 \
  || { docker rm -f "$STAGING" >/dev/null; docker volume rm "$VOLUME" >/dev/null 2>&1
       die "staging postgres never became ready"; }

note "restoring…"
docker cp "$DUMP" "$STAGING:/tmp/p.dump" >/dev/null
abort_staging() { docker rm -f "$STAGING" >/dev/null 2>&1; docker volume rm "$VOLUME" >/dev/null 2>&1; die "$1"; }

docker exec "$STAGING" pg_restore --no-owner --no-acl -U "$SNAP_USER" -d "$SNAP_DB" /tmp/p.dump \
  || abort_staging "pg_restore failed — old snapshot left untouched"

# Sanity-gate the restore before we throw the old one away. A restore that
# "succeeds" into an empty database is the worst outcome, because every row cap
# then looks latent and every finding gets dismissed.
VENDORS=$(docker exec "$STAGING" psql -U "$SNAP_USER" -d "$SNAP_DB" -tAc "select count(*) from vendor;" 2>/dev/null || echo 0)
[ "${VENDORS:-0}" -gt 0 ] \
  || abort_staging "restored DB has 0 vendors — bad restore, old snapshot kept"

# ── Swap ────────────────────────────────────────────────────────────────────
# Stop staging first so the volume has no writer, then hand the volume to a
# freshly-created container that publishes the port.
OLD_VOLUME=$(docker inspect "$CONTAINER" \
  --format '{{range .Mounts}}{{if eq .Destination "/var/lib/postgresql"}}{{.Name}}{{end}}{{end}}' 2>/dev/null || true)
docker rm -f "$STAGING" >/dev/null
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$CONTAINER" -v "$VOLUME:/var/lib/postgresql" -p "${HOST_PORT}:5432" \
  -e POSTGRES_PASSWORD="$SNAP_USER" -e POSTGRES_USER="$SNAP_USER" -e POSTGRES_DB="$SNAP_DB" \
  "$PG_IMAGE" >/dev/null
for _ in $(seq 1 60); do
  docker exec "$CONTAINER" pg_isready -U "$SNAP_USER" -d "$SNAP_DB" >/dev/null 2>&1 && break
  sleep 1
done
docker exec "$CONTAINER" pg_isready -U "$SNAP_USER" -d "$SNAP_DB" >/dev/null 2>&1 \
  || die "snapshot container did not come up on port ${HOST_PORT}"

# Only now is the previous volume unreferenced and safe to drop.
[ -n "${OLD_VOLUME:-}" ] && [ "$OLD_VOLUME" != "$VOLUME" ] \
  && docker volume rm "$OLD_VOLUME" >/dev/null 2>&1 || true

ok "snapshot refreshed"

# ── Report what landed, including migration parity with the repo ────────────
# Schema drift is the other way a snapshot lies: querying a table that prod has
# and the snapshot doesn't produces a confident, wrong "no such column".
echo
docker exec "$CONTAINER" psql -U "$SNAP_USER" -d "$SNAP_DB" -tA -F'|' -c \
  "select migration_name from _prisma_migrations order by finished_at desc nulls last limit 3;" \
  | sed 's/^/  applied: /'

# Compare as SETS, not "newest vs newest". Migrations do not necessarily apply in
# directory-name order — 20260728201310_vendor_name_unique was authored before
# 20260728234455_connection_auto_activate_contracts but deployed after it, so a
# newest-by-name vs newest-by-finished_at comparison reports drift that is not
# real. A warning that cries wolf is worse than no warning.
MIGRATIONS_DIR="$(dirname "$0")/../prisma/migrations"
MISSING=$(comm -23 \
  <(ls -1 "$MIGRATIONS_DIR" | grep -v migration_lock | sort) \
  <(docker exec "$CONTAINER" psql -U "$SNAP_USER" -d "$SNAP_DB" -tAc \
      "select migration_name from _prisma_migrations where finished_at is not null;" | sort))
if [ -n "$MISSING" ]; then
  warn "in the repo but NOT applied in prod:"
  echo "$MISSING" | sed 's/^/    /'
  warn "→ prod is behind the repo; row counts are fine but the SCHEMA is not."
else
  ok "migration parity: prod has every migration in the repo"
fi

echo
echo "  psql:   docker exec -it $CONTAINER psql -U $SNAP_USER -d $SNAP_DB"
echo "  note:   this is a COPY. Writing to it changes nothing in production."
