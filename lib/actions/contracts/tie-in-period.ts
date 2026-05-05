"use server"

/**
 * Per-period TIE_IN_CAPITAL evaluator wrapper — Charles canonical
 * engine wiring 2026-05-05 (T6).
 *
 * Wires the tested `lib/rebates/engine/tie-in-capital.ts` per-period
 * evaluator to the Prisma data model. The amortization SCHEDULE side
 * is already wired (via `buildTieInAmortizationSchedule` →
 * `getContractCapitalSchedule`); the per-period TRUE-UP side
 * (`calculateTieInCapital` returning `trueUpAdjustment` for a single
 * period) was unreachable from production until this wrapper.
 *
 * Why a wrapper, not a recompute writer: the lifetime "rebate applied
 * to capital" aggregate already routes through the canonical
 * `sumRebateAppliedToCapital` helper (CLAUDE.md invariants table).
 * Every customer-visible aggregate uses that helper — header card,
 * Capital Amortization card, reports — and switching to the engine's
 * per-period output would change those aggregates from collected-rebate
 * sums to engine-projected amounts. Out of scope for this batch.
 *
 * What this wrapper DOES: lets a future caller compute the engine's
 * per-period view (scheduled amortization vs earned rebate, signed
 * trueUpAdjustment per [A10], CARRY_FORWARD shortfall warnings).
 *
 * Scope guardrail: tydei capital lives in `ContractCapitalLineItem`
 * rows (1:N — see `lib/contracts/capital-line-items.ts`). The engine's
 * `TieInCapitalConfig` is single-asset (one capitalCost + one rate +
 * one termMonths). For contracts with a single line item the
 * conversion is exact; for multi-line contracts there is no faithful
 * single-asset projection, so the wrapper returns null with a
 * skipReason. The existing `getContractCapitalSchedule` action handles
 * multi-item aggregation onto a combined grid for the schedule side.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { calculateTieInCapital } from "@/lib/rebates/engine/tie-in-capital"
import { buildRebateConfigFromPrisma } from "@/lib/rebates/prisma-engine-bridge"
import { normalizeCapitalLineItems } from "@/lib/contracts/capital-line-items"
import type {
  PeriodData,
  PurchaseRecord,
  RebateResult,
  TieInCapitalConfig,
} from "@/lib/rebates/engine/types"
import { serialize } from "@/lib/serialize"

export interface TieInCapitalPeriodInput {
  contractId: string
  /** 1-indexed period within the amortization schedule. Default: 1. */
  periodNumber?: number
  /** Optional shortfall carried forward from the previous period. */
  carriedForwardShortfall?: number
  /** Period window (defaults to the contract's effective..today range). */
  periodStart?: Date | null
  periodEnd?: Date | null
}

export interface TieInCapitalPeriodResult {
  contractId: string
  /** null when the contract isn't a tie-in or lacks the required capital fields. */
  result: RebateResult | null
  diagnostics: {
    skipReason?: string
  }
}

/**
 * Compute the per-period tie-in capital evaluation for a contract.
 * Builds a `TieInCapitalConfig` from the contract's first capital line
 * item + its first SPEND_REBATE-shaped term (the nested rebate
 * engine), then invokes `calculateTieInCapital(config, periodData,
 * options)`.
 *
 * Auth: `requireFacility` + `contractOwnershipWhere`. Cross-facility
 * contracts return `result: null`.
 */
export async function getTieInCapitalForContractPeriod(
  input: TieInCapitalPeriodInput,
): Promise<TieInCapitalPeriodResult> {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUnique({
    where: contractOwnershipWhere(input.contractId, facility.id),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      capitalLineItems: { orderBy: { createdAt: "asc" } },
    },
  })

  if (!contract) {
    return serialize({
      contractId: input.contractId,
      result: null,
      diagnostics: { skipReason: "contract not visible to facility" },
    })
  }

  if (
    contract.contractType !== "tie_in" &&
    contract.contractType !== "capital"
  ) {
    return serialize({
      contractId: input.contractId,
      result: null,
      diagnostics: { skipReason: "contract is not tie_in / capital" },
    })
  }

  const lineItems = normalizeCapitalLineItems(contract)
  if (lineItems.length === 0) {
    return serialize({
      contractId: input.contractId,
      result: null,
      diagnostics: { skipReason: "no ContractCapitalLineItem rows" },
    })
  }
  if (lineItems.length > 1) {
    return serialize({
      contractId: input.contractId,
      result: null,
      diagnostics: {
        skipReason:
          "multi-line capital contract not supported by single-asset TieInCapitalConfig — use getContractCapitalSchedule for the aggregated schedule view",
      },
    })
  }
  const item = lineItems[0]!

  // Build the nested SPEND_REBATE config from the first non-pricing
  // term that the bridge can map. Restricted to SPEND_REBATE because
  // tydei tie-in seed contracts use spend-based rebate ladders for
  // capital amortization. The engine itself supports VOLUME / CARVE_OUT /
  // MARKET_SHARE_REBATE nested engines but they aren't represented by
  // tie-in seed contracts today.
  const candidateTerm = contract.terms.find((t) => {
    const cfg = buildRebateConfigFromPrisma(t)
    return cfg?.type === "SPEND_REBATE"
  })
  if (!candidateTerm) {
    return serialize({
      contractId: input.contractId,
      result: null,
      diagnostics: {
        skipReason: "no SPEND_REBATE-shaped term to embed as the nested engine",
      },
    })
  }
  const nestedConfig = buildRebateConfigFromPrisma(candidateTerm)
  if (!nestedConfig || nestedConfig.type !== "SPEND_REBATE") {
    return serialize({
      contractId: input.contractId,
      result: null,
      diagnostics: { skipReason: "bridge produced non-SPEND_REBATE config" },
    })
  }

  const tieInConfig: TieInCapitalConfig = {
    type: "TIE_IN_CAPITAL",
    capitalCost: item.contractTotal,
    downPayment: item.initialSales,
    interestRate: item.interestRate,
    termMonths: item.termMonths,
    period: item.paymentCadence,
    // Default to CARRY_FORWARD (the more conservative shortfall
    // posture); BILL_IMMEDIATELY would emit per-period billing
    // warnings the UI doesn't yet surface.
    shortfallHandling: "CARRY_FORWARD",
    rebateEngine: nestedConfig,
  }

  const start = input.periodStart ?? contract.effectiveDate
  const end = new Date(
    Math.min(
      (input.periodEnd ?? new Date()).getTime(),
      contract.expirationDate.getTime(),
    ),
  )

  // Pull on-contract COG for the nested SPEND_REBATE evaluation. The
  // engine filters by spendBasis so we don't pre-filter by category.
  const cog = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorId: contract.vendorId,
      transactionDate: { gte: start, lte: end },
    },
    select: {
      referenceNumber: true,
      category: true,
      quantity: true,
      unitPrice: true,
      extendedPrice: true,
      transactionDate: true,
    },
  })

  const purchases: PurchaseRecord[] = cog.map((r) => ({
    referenceNumber: r.referenceNumber,
    productCategory: r.category ?? null,
    quantity: Number(r.quantity ?? 0),
    unitPrice: Number(r.unitPrice ?? 0),
    extendedPrice: Number(r.extendedPrice ?? 0),
    purchaseDate: r.transactionDate,
  }))
  const totalSpend = purchases.reduce((acc, p) => acc + p.extendedPrice, 0)

  const periodData: PeriodData = {
    purchases,
    totalSpend,
    periodLabel: `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`,
  }

  const result = calculateTieInCapital(tieInConfig, periodData, {
    periodNumber: input.periodNumber ?? 1,
    carriedForwardShortfall: input.carriedForwardShortfall ?? 0,
  })

  return serialize({
    contractId: input.contractId,
    result,
    diagnostics: {},
  })
}
