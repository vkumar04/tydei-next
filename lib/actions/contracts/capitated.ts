"use server"

/**
 * Capitated rebate adapter + server action — Charles canonical engine
 * wiring 2026-05-05 (T5).
 *
 * Wires the tested `lib/rebates/engine/capitated.ts` to the Prisma data
 * model. Capitated terms ring-fence a group of reference numbers behind
 * a per-period spend cap; an optional embedded sub-engine
 * (SPEND_REBATE or TIER_PRICE_REDUCTION) is then evaluated on the
 * capped slice. The bridge handles the embedded SPEND_REBATE case
 * (built from the same term's tiers); embedded TIER_PRICE_REDUCTION is
 * not yet expressible in tydei's term schema.
 *
 * Why a wrapper, not a recompute writer: capitated terms (specifically
 * `capitated_pricing_rebate`) currently route through
 * `recomputeVolumeAccrualForTerm` (CPT-occurrence-based per-procedure
 * rebate). The CAPITATED engine is a different shape — it caps DOLLAR
 * group spend and pays the embedded rebate on the capped amount.
 * Touching the existing volume writer would change persisted
 * Rebate-row numbers and is out of scope. This wrapper exposes the
 * canonical engine for future Performance + reports surfaces.
 *
 * Term-type routing: this wrapper handles
 * `capitated_price_reduction` (the only term type the bridge maps to
 * CAPITATED today). `capitated_pricing_rebate` is routed by the bridge
 * to VOLUME_REBATE because that's how the seed + UI model it; calling
 * this wrapper on a `capitated_pricing_rebate` term will skip with a
 * diagnostic.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { calculateRebate } from "@/lib/rebates/engine"
import { buildRebateConfigFromPrisma } from "@/lib/rebates/prisma-engine-bridge"
import type {
  PeriodData,
  PurchaseRecord,
  RebateResult,
} from "@/lib/rebates/engine/types"
import { serialize } from "@/lib/serialize"

export interface CapitatedRebateInput {
  contractId: string
  /** Window start (defaults to contract.effectiveDate). */
  periodStart?: Date | null
  /** Window end (defaults to today, capped at contract.expirationDate). */
  periodEnd?: Date | null
}

export interface CapitatedRebateResult {
  contractId: string
  termId: string | null
  /** null when the contract has no capitated_price_reduction term with a periodCap. */
  result: RebateResult | null
  diagnostics: {
    skipReason?: string
    periodCap?: number
    groupedReferenceNumberCount?: number
  }
}

/**
 * Compute the canonical-engine capitated rebate for a contract over a
 * window. Pulls the first `capitated_price_reduction` term that has a
 * non-null `periodCap`, builds the engine config via the bridge,
 * filters COG to the term's `groupedReferenceNumbers`, and runs the
 * engine.
 *
 * Auth: `requireFacility` + `contractOwnershipWhere`.
 */
export async function getCapitatedRebateForContract(
  input: CapitatedRebateInput,
): Promise<CapitatedRebateResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(input.contractId, facility.id),
    include: {
      terms: {
        where: { termType: "capitated_price_reduction" },
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })

  if (!contract) {
    return serialize({
      contractId: input.contractId,
      termId: null,
      result: null,
      diagnostics: { skipReason: "contract not visible to facility" },
    })
  }

  const term = contract.terms[0]
  if (!term) {
    return serialize({
      contractId: input.contractId,
      termId: null,
      result: null,
      diagnostics: {
        skipReason: "no capitated_price_reduction term on contract",
      },
    })
  }

  const config = buildRebateConfigFromPrisma(term)
  if (!config || config.type !== "CAPITATED") {
    return serialize({
      contractId: input.contractId,
      termId: term.id,
      result: null,
      diagnostics: {
        skipReason: `bridge returned ${config?.type ?? "null"} for capitated_price_reduction term (likely missing periodCap)`,
      },
    })
  }

  const start = input.periodStart ?? contract.effectiveDate
  const end = new Date(
    Math.min(
      (input.periodEnd ?? new Date()).getTime(),
      contract.expirationDate.getTime(),
    ),
  )

  // Pull every COG row for the contract's vendor in window. The
  // engine itself filters by `groupedReferenceNumbers` ([A8]) — we
  // could pre-filter at the DB layer but that obscures the cap-overage
  // diagnostics if a row is just outside the group.
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: { gte: start, lte: end },
    },
    select: {
      inventoryNumber: true,
      category: true,
      quantity: true,
      unitCost: true,
      extendedPrice: true,
      transactionDate: true,
    },
  })

  const purchases: PurchaseRecord[] = cog.map((r) => ({
    referenceNumber: r.inventoryNumber,
    productCategory: r.category ?? null,
    quantity: Number(r.quantity ?? 0),
    unitPrice: Number(r.unitCost ?? 0),
    extendedPrice: Number(r.extendedPrice ?? 0),
    purchaseDate: r.transactionDate,
  }))
  const totalSpend = purchases.reduce((acc, p) => acc + p.extendedPrice, 0)

  const periodData: PeriodData = {
    purchases,
    totalSpend,
    periodLabel: `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`,
  }

  const result = calculateRebate(config, periodData)

  return serialize({
    contractId: input.contractId,
    termId: term.id,
    result,
    diagnostics: {
      periodCap: config.periodCap,
      groupedReferenceNumberCount: config.groupedReferenceNumbers.length,
    },
  })
}
