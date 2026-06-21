"use server"

/**
 * Charles 2026-04-25 (audit follow-up): aggregate persisted Rebate
 * rows across the facility's active contracts grouped by the
 * underlying term's `termType`. Answers "what % of my earned came
 * from spend rebates vs volume vs PO vs threshold vs payment?"
 *
 * Thin facility wrapper: gate (`requireFacility`) → scope
 * (`contractsOwnedByFacility`) → load the Rebate rows + term map →
 * delegate the bucketing math to the shared pure core
 * `bucketRebatesByType` (`lib/reports/infer-type.ts`), which the vendor
 * mirror also uses so the two surfaces can never drift.
 *
 * Implementation notes:
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
 *     stable. A future v2 could add a date-range param.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { bucketRebatesByType } from "@/lib/reports/infer-type"

export type { RebateTypeBucket } from "@/lib/reports/infer-type"

export async function getRebateBreakdownByType() {
  try {
    const { facility } = await requireFacility()

    // Pull every Rebate row at the facility plus the contract-term
    // map so we can resolve termType per row.
    const baseWhere = contractsOwnedByFacility(facility.id)
    const rebates = await prisma.rebate.findMany({
      where: {
        contract: baseWhere,
      },
      select: {
        contractId: true,
        rebateEarned: true,
        rebateCollected: true,
        // Charles audit round-1 facility CONCERN-A: needed by
        // sumCollectedRebates which filters on collectionDate != null.
        collectionDate: true,
        notes: true,
      },
    })

    // Load every term once so we can resolve term.id → termType
    // without N+1 queries. Scoped to the facility's contracts to
    // keep the working set small.
    const terms = await prisma.contractTerm.findMany({
      where: { contract: baseWhere },
      select: { id: true, termType: true },
    })
    const termTypeById = new Map(terms.map((t) => [t.id, t.termType]))

    // Charles audit round-1 facility CONCERN-A: route the collected
    // aggregate through the canonical sumCollectedRebates helper so the
    // "Collected" filter (collectionDate != null) is owned by exactly
    // one place. See CLAUDE.md canonical-reducers invariants table.
    const result = bucketRebatesByType(
      rebates,
      termTypeById,
      sumCollectedRebates,
    )
    return serialize(result)
  } catch (err) {
    console.error("[getRebateBreakdownByType]", err)
    throw err
  }
}
