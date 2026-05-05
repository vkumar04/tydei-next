"use server"

/**
 * Market-share rebate adapter + server action — Charles canonical
 * engine wiring 2026-05-05 (T4).
 *
 * Wires the tested `lib/rebates/engine/market-share-rebate.ts` (and
 * its `MARKET_SHARE_PRICE_REDUCTION` peer) to the Prisma data model.
 * Builds the engine config from the contract's `market_share` /
 * `market_share_price_reduction` term + tiers via the canonical
 * bridge, computes the period's vendor + total category spend from
 * COG, and runs the engine.
 *
 * Why a wrapper, not a recompute writer: market-share rebates have
 * been routed through `recomputeThresholdAccrualForTerm` historically
 * (treating the threshold-crossing as a flat per-period payout). The
 * canonical engine performs richer math — tier-based percent of
 * `vendorCategorySpend` (cumulative) or proportional bucketing across
 * share-percent brackets (marginal). This wrapper exposes the engine
 * for future Performance-tab + reports surfaces without touching the
 * existing accrual writer (which would change persisted Rebate-row
 * numbers and is out of scope for the canonical-engine wiring batch).
 *
 * No UI consumer today. Reachable from any caller that needs the
 * canonical engine's market-share dollar number.
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

export interface MarketShareRebateInput {
  contractId: string
  /** Window start (defaults to contract.effectiveDate). */
  periodStart?: Date | null
  /** Window end (defaults to today, capped at contract.expirationDate). */
  periodEnd?: Date | null
}

export interface MarketShareRebateContractResult {
  contractId: string
  termId: string | null
  /** null when the contract has no market_share / market_share_price_reduction term. */
  result: RebateResult | null
  diagnostics: {
    skipReason?: string
    /** The category against which share % was computed. */
    category?: string | null
    vendorCategorySpend?: number
    totalCategorySpend?: number
  }
}

/**
 * Compute the canonical-engine market-share rebate for a contract over
 * a window. Pulls the first `market_share` (or
 * `market_share_price_reduction`) term, builds the engine config via
 * the bridge, computes vendor + total category spend from COG over the
 * window, and runs the engine.
 *
 * Auth: `requireFacility` + `contractOwnershipWhere`. Cross-facility
 * contracts return `result: null` with a `skipReason` rather than
 * throw.
 */
export async function getMarketShareRebateForContract(
  input: MarketShareRebateInput,
): Promise<MarketShareRebateContractResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(input.contractId, facility.id),
    include: {
      terms: {
        where: {
          termType: { in: ["market_share", "market_share_price_reduction"] },
        },
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      productCategory: { select: { name: true } },
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
      diagnostics: { skipReason: "no market_share term on contract" },
    })
  }

  const config = buildRebateConfigFromPrisma(term)
  if (
    !config ||
    (config.type !== "MARKET_SHARE_REBATE" &&
      config.type !== "MARKET_SHARE_PRICE_REDUCTION")
  ) {
    return serialize({
      contractId: input.contractId,
      termId: term.id,
      result: null,
      diagnostics: {
        skipReason: `bridge returned ${config?.type ?? "null"} for market_share term`,
      },
    })
  }

  // Resolve the category for share computation: for MARKET_SHARE_REBATE
  // the term-level `marketShareCategory` wins; fall back to the
  // contract's productCategory.name. The MARKET_SHARE_PRICE_REDUCTION
  // engine config doesn't carry a category — use the contract's only.
  const category: string | null =
    config.type === "MARKET_SHARE_REBATE" && config.marketShareCategory
      ? config.marketShareCategory
      : contract.productCategory?.name ?? null

  const start = input.periodStart ?? contract.effectiveDate
  const end = new Date(
    Math.min(
      (input.periodEnd ?? new Date()).getTime(),
      contract.expirationDate.getTime(),
    ),
  )

  // Pull all in-category COG rows for the facility in window — both
  // total (for denominator) and vendor-specific (for numerator).
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      transactionDate: { gte: start, lte: end },
      ...(category ? { category } : {}),
    },
    select: {
      vendorId: true,
      inventoryNumber: true,
      category: true,
      quantity: true,
      unitCost: true,
      extendedPrice: true,
      transactionDate: true,
    },
  })

  const totalCategorySpend = cog.reduce(
    (acc, r) => acc + Number(r.extendedPrice ?? 0),
    0,
  )
  const vendorRows = cog.filter((r) => r.vendorId === contract.vendorId)
  const vendorCategorySpend = vendorRows.reduce(
    (acc, r) => acc + Number(r.extendedPrice ?? 0),
    0,
  )

  const purchases: PurchaseRecord[] = vendorRows.map((r) => ({
    referenceNumber: r.inventoryNumber,
    productCategory: r.category ?? null,
    quantity: Number(r.quantity ?? 0),
    unitPrice: Number(r.unitCost ?? 0),
    extendedPrice: Number(r.extendedPrice ?? 0),
    purchaseDate: r.transactionDate,
  }))

  const periodData: PeriodData = {
    purchases,
    totalSpend: vendorCategorySpend,
    totalCategorySpend,
    vendorCategorySpend,
    periodLabel: `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`,
  }

  const result = calculateRebate(config, periodData)

  return serialize({
    contractId: input.contractId,
    termId: term.id,
    result,
    diagnostics: {
      category,
      vendorCategorySpend,
      totalCategorySpend,
    },
  })
}
