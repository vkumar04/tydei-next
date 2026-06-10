/**
 * Canonical where-fragments for vendor PROSPECTIVE proposals stored on
 * `PendingContract` (proposal-feed split, 2026-06-09).
 *
 * Prospective proposals ("My Contract Proposals" on /vendor/prospective)
 * are vendor-internal analysis documents — they were previously
 * persisted as masquerade `Alert` rows (metadata
 * `{ type: "vendor_proposal" }`, see lib/alerts/vendor-proposal-filter.ts
 * for the legacy exclusion). They now live as `PendingContract` rows:
 *
 *   - `status: "draft"` — never enters the facility review workflow
 *     (approve/reject operate facility-scoped and these rows carry
 *     `facilityId: null`, so facilities can't even see them).
 *   - `pricingData.kind === "vendor_proposal"` — discriminates them
 *     from any future real draft submissions.
 *
 * The vendor contract-submission surfaces (`getVendorPendingContracts`)
 * must EXCLUDE these rows; `getVendorProposals` / `deleteProposal` in
 * lib/actions/prospective.ts read/delete ONLY these rows. Same Prisma
 * JSON-path null-semantics as lib/alerts/spend-target-filter.ts: the
 * exclusion must be the OR of "path missing" and "path differs".
 */

import { Prisma } from "@/lib/generated/prisma/client"

/** Discriminator stored at `pricingData.kind`. */
export const PROSPECTIVE_PROPOSAL_KIND = "vendor_proposal"

/**
 * Where-fragment matching ONLY prospective-proposal rows. Compose with
 * the vendor scope: `{ vendorId, ...onlyProspectiveProposalRows() }`.
 */
export function onlyProspectiveProposalRows(): Prisma.PendingContractWhereInput {
  return {
    status: "draft",
    pricingData: { path: ["kind"], equals: PROSPECTIVE_PROPOSAL_KIND },
  }
}

/**
 * Where-fragment matching every PendingContract that is NOT a
 * prospective proposal (the real submission pipeline). Compose with
 * AND/spread: `{ vendorId, ...excludeProspectiveProposalRows() }`.
 */
export function excludeProspectiveProposalRows(): Prisma.PendingContractWhereInput {
  return {
    OR: [
      // `kind` key absent (all real submissions; also NULL pricingData).
      { pricingData: { path: ["kind"], equals: Prisma.AnyNull } },
      // `kind` key present but not a prospective proposal.
      { pricingData: { path: ["kind"], not: PROSPECTIVE_PROPOSAL_KIND } },
    ],
  }
}
