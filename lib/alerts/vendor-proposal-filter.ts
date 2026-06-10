/**
 * Canonical where-fragments separating REAL vendor alerts from legacy
 * vendor-proposal rows (proposal-feed split, 2026-06-09).
 *
 * `createProposal` (lib/actions/prospective.ts) historically persisted
 * vendor prospective proposals as `Alert` rows (`alertType:
 * "compliance"`, metadata `{ type: "vendor_proposal" }`) to avoid a
 * schema migration — they were frequently the ONLY "alerts" a vendor
 * ever saw. New proposals are stored as draft `PendingContract` rows
 * (see lib/prospective/proposal-rows.ts); the masquerade Alert write is
 * gone. But legacy rows persist in older databases, so every vendor
 * alert surface must exclude them, and `getVendorProposals` /
 * `deleteProposal` keep a tolerant legacy read/delete path.
 *
 * SQL-NULL trap (same as lib/alerts/spend-target-filter.ts, verified
 * against live Postgres on 2026-06-09): the naive
 * `NOT: { metadata: { path: ["type"], equals: "vendor_proposal" } }`
 * filter excludes EVERY row that lacks a `type` key, because
 * `metadata#>'{type}'` is SQL NULL for those rows and `NOT (NULL = x)`
 * is NULL → filtered out. Real alerts don't carry a `type` key, so the
 * naive filter returns nothing. The OR-shape below is the correct
 * exclusion: "path is missing" OR "path differs".
 */

import { Prisma } from "@/lib/generated/prisma/client"

/**
 * Where-fragment matching every alert that is NOT a legacy vendor
 * proposal. Compose with AND:
 * `{ AND: [ ...scope, excludeVendorProposalAlerts() ] }`.
 */
export function excludeVendorProposalAlerts(): Prisma.AlertWhereInput {
  return {
    OR: [
      // `type` key absent (all synthesizer + legacy alerts).
      { metadata: { path: ["type"], equals: Prisma.AnyNull } },
      // `type` key present but not a vendor proposal.
      { metadata: { path: ["type"], not: "vendor_proposal" } },
    ],
  }
}

/**
 * Where-fragment matching ONLY legacy masquerade proposal rows — the
 * tolerant legacy read used by `getVendorProposals` / `deleteProposal`.
 */
export function onlyVendorProposalAlerts(): Prisma.AlertWhereInput {
  return {
    metadata: { path: ["type"], equals: "vendor_proposal" },
  }
}
