"use server"

/**
 * Vendor-scoped mirror of `getRebateBreakdownByType`
 * (`lib/actions/reports/by-rebate-type.ts`). Aggregates persisted
 * Rebate rows across the calling VENDOR's contracts (primary vendor OR
 * grouped participant via `contractsOwnedByVendor`) grouped by the
 * underlying term's `termType`. Answers "what % of earned came from
 * spend rebates vs volume vs PO vs threshold vs payment?" from the
 * vendor's vantage point.
 *
 * Byte-identical return shape (`RebateTypeBucket[]`) to the facility
 * action — the shared presentational tab consumes both. The bucketing
 * math is the SAME shared pure core (`bucketRebatesByType` in
 * `lib/reports/infer-type.ts`); the only difference vs the facility
 * source is the auth gate (`requireVendor()` → `vendor.id`) and the
 * contract base-where (`contractsOwnedByVendor` instead of
 * `contractsOwnedByFacility`).
 *
 * Implementation notes (unchanged from source):
 *   - The auto-* notes prefixes embed `term:<id>` for every writer
 *     except the spend writer (`[auto-accrual]` writes don't carry
 *     the term id because the spend writer aggregates across all
 *     spend-eligible terms before persisting). For non-spend rows
 *     we parse the term id out of the prefix and look up the term's
 *     termType. For spend rows we attribute to "spend_rebate".
 *   - Manually-collected rows (no `[auto-` prefix) are bucketed
 *     under "manual" so the user can audit any divergence between
 *     engine output and human entries.
 *   - Lifetime totals only — no date filter — so the picture stays
 *     stable.
 */
import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { bucketRebatesByType } from "@/lib/reports/infer-type"

export type { RebateTypeBucket } from "@/lib/reports/infer-type"

export async function getVendorRebateBreakdownByType() {
  try {
    const { vendor } = await requireVendor()

    // Pull every Rebate row across the vendor's contracts plus the
    // contract-term map so we can resolve termType per row.
    const baseWhere = contractsOwnedByVendor(vendor.id)
    const rebates = await prisma.rebate.findMany({
      where: {
        contract: baseWhere,
      },
      select: {
        contractId: true,
        rebateEarned: true,
        rebateCollected: true,
        // Needed by sumCollectedRebates which filters on
        // collectionDate != null.
        collectionDate: true,
        notes: true,
      },
    })

    // Load every term once so we can resolve term.id → termType
    // without N+1 queries. Scoped to the vendor's contracts to keep
    // the working set small.
    const terms = await prisma.contractTerm.findMany({
      where: { contract: baseWhere },
      select: { id: true, termType: true },
    })
    const termTypeById = new Map(terms.map((t) => [t.id, t.termType]))

    // Route the collected aggregate through the canonical
    // sumCollectedRebates helper so the "Collected" filter
    // (collectionDate != null) is owned by exactly one place. See
    // CLAUDE.md canonical-reducers invariants table.
    const result = bucketRebatesByType(
      rebates,
      termTypeById,
      sumCollectedRebates,
    )
    return serialize(result)
  } catch (err) {
    console.error("[getVendorRebateBreakdownByType]", err)
    throw err
  }
}
