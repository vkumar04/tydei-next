/**
 * Canonical where-fragments separating REAL alerts from rebate-optimizer
 * spend targets (2026-06-09 renewals+alerts audit H5).
 *
 * `setSpendTarget` (lib/actions/rebate-optimizer.ts) persists spend
 * targets as `Alert` rows (`alertType: "tier_threshold"`, metadata
 * `{ type: "spend_target" }`) to avoid a schema migration. That means
 * every alert surface (list, unread count, priority ranking, bulk
 * actions, mark-all-read) would otherwise treat them as alerts —
 * "Spend target set" rows polluted the inbox, and a stray mark-read /
 * dismiss DESTROYED the target (getSpendTargets used to require
 * status "new_alert").
 *
 * SQL-NULL trap (verified against the live Postgres on 2026-06-09):
 * the naive `NOT: { metadata: { path: ["type"], equals: "spend_target" } }`
 * filter excludes EVERY row that lacks a `type` key, because
 * `metadata#>'{type}'` is SQL NULL for those rows and `NOT (NULL = x)`
 * is NULL → filtered out. Real alerts don't carry a `type` key, so the
 * naive filter returns nothing. The OR-shape below is the correct
 * exclusion: "path is missing" OR "path differs".
 */

import { Prisma } from "@/lib/generated/prisma/client"

/**
 * Where-fragment matching every alert that is NOT a spend target.
 * Compose with AND: `{ AND: [ ...scope, excludeSpendTargetAlerts() ] }`.
 */
export function excludeSpendTargetAlerts(): Prisma.AlertWhereInput {
  return {
    OR: [
      // `type` key absent (all synthesizer + legacy alerts).
      { metadata: { path: ["type"], equals: Prisma.AnyNull } },
      // `type` key present but not a spend target.
      { metadata: { path: ["type"], not: "spend_target" } },
    ],
  }
}

/**
 * Where-fragment matching ONLY spend-target rows — the read side used
 * by `getSpendTargets`. Deliberately status-free: a stray mark-read /
 * dismiss from an alert surface must not hide a target (audit H5).
 */
export function onlySpendTargetAlerts(): Prisma.AlertWhereInput {
  return {
    metadata: { path: ["type"], equals: "spend_target" },
  }
}
