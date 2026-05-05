"use server"

/**
 * Tier price-reduction adapter + server action — Charles canonical
 * engine wiring 2026-05-05 (T3).
 *
 * Wires the tested `lib/rebates/engine/tier-price-reduction.ts` to the
 * Prisma data model. Builds a TIER_PRICE_REDUCTION config from the
 * contract's `price_reduction` term + tiers via the canonical bridge,
 * pulls COG purchases for the evaluation window, and runs the engine.
 * Returns the standardized RebateResult with `priceReductionLines[]` —
 * one per filtered purchase showing original vs effective unit price.
 *
 * Why a wrapper, not a recompute writer: price-reduction terms have
 * NO rebate accrual (the dropdown description in
 * `components/contracts/contract-terms-entry.tsx` is explicit:
 * "Pricing-only contract — discounted prices applied via the Pricing
 * tab. No separate rebate accrual"). The engine still has value as a
 * computable benefit number for reports + UI surfaces; this wrapper
 * makes it reachable without forcing a Rebate-row writer that would
 * conflict with that contract.
 *
 * No UI consumer today. Future use cases: contract-detail Performance
 * tab "estimated price-reduction benefit", reports rollup, prospective
 * analysis savings projection.
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

export interface TierPriceReductionInput {
  contractId: string
  /** Window start (defaults to contract.effectiveDate). */
  periodStart?: Date | null
  /** Window end (defaults to today, capped at contract.expirationDate). */
  periodEnd?: Date | null
}

export interface TierPriceReductionResult {
  contractId: string
  termId: string | null
  /** null when the contract has no price_reduction term. */
  result: RebateResult | null
  diagnostics: {
    /** Reason `result` is null, when applicable. */
    skipReason?: string
  }
}

/**
 * Compute the tier-price-reduction benefit for a contract over the
 * given window. Pulls the first `price_reduction` term on the contract
 * (per current data model — multi-term price reduction is rare and not
 * captured by any UI today), builds a TIER_PRICE_REDUCTION config via
 * the canonical bridge, and runs the engine on the COG slice.
 *
 * Auth: `requireFacility` + `contractOwnershipWhere`. Cross-facility
 * contractIds return null result with a `skipReason: "not visible"`
 * diagnostic instead of throwing — caller decides whether to surface
 * an error.
 */
export async function getTierPriceReductionForContract(
  input: TierPriceReductionInput,
): Promise<TierPriceReductionResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(input.contractId, facility.id),
    include: {
      terms: {
        where: { termType: "price_reduction" },
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
      diagnostics: { skipReason: "no price_reduction term on contract" },
    })
  }

  const config = buildRebateConfigFromPrisma(term)
  if (!config || config.type !== "TIER_PRICE_REDUCTION") {
    return serialize({
      contractId: input.contractId,
      termId: term.id,
      result: null,
      diagnostics: {
        skipReason: `bridge returned ${config?.type ?? "null"} for price_reduction term`,
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

  // Pull on-contract COG within the window. Engine filters by
  // spendBasis (ALL_SPEND / REFERENCE_NUMBER / PRODUCT_CATEGORY) so
  // we don't need to pre-filter by category here.
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: { gte: start, lte: end },
      matchStatus: { in: ["on_contract", "price_variance"] },
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
    diagnostics: {},
  })
}
