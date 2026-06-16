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
 * action — the shared presentational tab consumes both. The only
 * difference vs the facility source is the auth gate
 * (`requireVendor()` → `vendor.id`) and the contract base-where
 * (`contractsOwnedByVendor` instead of `contractsOwnedByFacility`).
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

export interface RebateTypeBucket {
  termType: string
  earned: number
  collected: number
  rowCount: number
  contractCount: number
  /**
   * True when ANY row in this bucket was attributed via the auto-*
   * notes-prefix fallback (term lookup missed) rather than a clean
   * term:<id> resolution. Surfaces in the UI as an "inferred from
   * notes prefix" badge so the reviewer knows the bucket is best-
   * effort.
   */
  inferred: boolean
}

/**
 * Maps an auto-accrual notes prefix to a fallback termType label,
 * used only when the row's `term:<id>` cannot be resolved (term was
 * deleted, notes truncated, etc.). Threshold rows fall back to
 * `compliance_rebate` rather than the synthetic
 * "compliance_or_market_share" literal — the bucket is still
 * imprecise but it's at least a real enum value the UI knows how to
 * label.
 */
const PREFIX_TO_INFERRED_TYPE: Record<string, string> = {
  "[auto-accrual]": "spend_rebate",
  "[auto-volume-accrual]": "volume_rebate",
  "[auto-po-accrual]": "po_rebate",
  "[auto-threshold-accrual]": "compliance_rebate",
  "[auto-invoice-accrual]": "payment_rebate",
}

function inferTypeFromNotes(notes: string | null): {
  termId: string | null
  fallbackType: string
} {
  if (!notes) return { termId: null, fallbackType: "manual" }
  // Try each prefix.
  for (const [prefix, type] of Object.entries(PREFIX_TO_INFERRED_TYPE)) {
    if (notes.startsWith(prefix)) {
      // Notes shape: "[auto-X-accrual] term:<id> · …"
      const match = notes.match(/term:([a-z0-9]+)/i)
      return {
        termId: match?.[1] ?? null,
        fallbackType: type,
      }
    }
  }
  return { termId: null, fallbackType: "manual" }
}

export async function getVendorRebateBreakdownByType(): Promise<
  RebateTypeBucket[]
> {
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

    const buckets = new Map<
      string,
      {
        earned: number
        collected: number
        rowCount: number
        contracts: Set<string>
        // True when at least one row landed in this bucket via the
        // prefix fallback (manual rows or rows whose term:<id> didn't
        // resolve). Drives the UI's "inferred from notes prefix" badge
        // so the reviewer knows the attribution is best-effort.
        inferred: boolean
      }
    >()
    for (const r of rebates) {
      const inferred = inferTypeFromNotes(r.notes)
      let termType: string
      let isInferred: boolean
      if (inferred.termId && termTypeById.has(inferred.termId)) {
        termType = termTypeById.get(inferred.termId)!
        isInferred = false
      } else {
        termType = inferred.fallbackType
        isInferred = true
      }
      const bucket = buckets.get(termType) ?? {
        earned: 0,
        collected: 0,
        rowCount: 0,
        contracts: new Set<string>(),
        inferred: false,
      }
      bucket.earned += Number(r.rebateEarned ?? 0)
      // Route the collected aggregate through the canonical
      // sumCollectedRebates helper so the "Collected" filter
      // (collectionDate != null) is owned by exactly one place. See
      // CLAUDE.md canonical-reducers invariants table.
      bucket.collected += sumCollectedRebates([r])
      bucket.rowCount += 1
      bucket.contracts.add(r.contractId)
      if (isInferred) bucket.inferred = true
      buckets.set(termType, bucket)
    }

    const result: RebateTypeBucket[] = []
    for (const [termType, b] of buckets.entries()) {
      result.push({
        termType,
        earned: b.earned,
        collected: b.collected,
        rowCount: b.rowCount,
        contractCount: b.contracts.size,
        inferred: b.inferred,
      })
    }
    // Sort biggest earned first — most material first.
    result.sort((a, b) => b.earned - a.earned)
    return serialize(result)
  } catch (err) {
    console.error("[getVendorRebateBreakdownByType]", err)
    throw err
  }
}
