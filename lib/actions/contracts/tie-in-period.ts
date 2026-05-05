"use server"

/**
 * Per-period TIE_IN_CAPITAL evaluator wrapper — Charles canonical
 * engine wiring 2026-05-05 (T6) + multi-line extension 2026-05-04.
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
 * Multi-line capital (1:N `ContractCapitalLineItem`): the engine's
 * `TieInCapitalConfig` is single-asset (one capitalCost + one rate +
 * one termMonths). Rather than extend the engine type, the wrapper
 * iterates over line items and invokes the engine ONCE PER LINE,
 * then aggregates the results. Reasons:
 *   - engine math stays pure and matches Charles's spec
 *   - per-line results are useful (which line is shortfalled,
 *     which is paid off, which is over-accrued)
 *   - aggregation logic is wrapper-specific; engine doesn't need to
 *     know about tydei's schema
 * The nested `rebateEngine` (SPEND_REBATE) is shared across lines
 * because it's a contract-level construct, not a per-line one — a
 * single rebate engine fires on COG for the whole contract. The
 * carriedForwardShortfall input applies uniformly to every line for
 * now (a future caller may want per-line carry-forward state — this
 * wrapper exposes per-line trueUp output so that's straightforward).
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { calculateTieInCapital } from "@/lib/rebates/engine/tie-in-capital"
import { buildRebateConfigFromPrisma } from "@/lib/rebates/prisma-engine-bridge"
import {
  normalizeCapitalLineItems,
  type NormalizedCapitalLineItem,
} from "@/lib/contracts/capital-line-items"
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

export interface TieInCapitalPerLineResult {
  lineItemId: string
  lineDescription: string
  /**
   * The per-line engine result. Always populated for valid lines
   * reaching the engine call.
   */
  engineResult: RebateResult
}

export interface TieInCapitalPeriodResult {
  contractId: string
  /**
   * Single-line case: the engine result (matches the original
   * single-line wrapper API). Multi-line case: the FIRST line's
   * engine result, kept for backward shape; consumers wanting the
   * full picture should read `perLine` and the totals below.
   * `null` when the contract is not eligible (not tie_in / capital,
   * no line items, or no nested SPEND_REBATE term).
   */
  result: RebateResult | null
  /**
   * Per-line breakdown. Empty array when the contract is not eligible.
   * Length === number of `ContractCapitalLineItem` rows when eligible.
   */
  perLine: TieInCapitalPerLineResult[]
  /** Sum of `amortizationEntry.amortizationDue` across all lines. */
  totalScheduledAmortizationDue: number
  /**
   * Sum of `rebateEarned` across all lines. Note: with a contract-level
   * nested rebate engine, every line evaluates the SAME COG window and
   * therefore returns the SAME rebateEarned. The total is the sum
   * (one entry per line) so per-line shortfalls bookkeep cleanly
   * against per-line amortization due. Callers wanting "rebate earned
   * by the contract this period" should read `perLine[0].engineResult
   * .rebateEarned` (or any single line) instead of dividing by line
   * count.
   */
  totalRebateApplied: number
  /**
   * Sum of POSITIVE `trueUpAdjustment` across lines (i.e. only the
   * shortfall lines). Negative trueUps (over-accrual) are NOT netted
   * here — they're surfaced per-line in `perLine[i].engineResult
   * .trueUpAdjustment`.
   */
  totalShortfall: number
  /**
   * Sum of `amortizationEntry.closingBalance` across all lines for the
   * evaluated period.
   */
  totalRemainingBalance: number
  /** Aggregated warnings across lines (concat). */
  warnings: string[]
  diagnostics: {
    skipReason?: string
  }
}

function emptyResult(
  contractId: string,
  skipReason: string,
): TieInCapitalPeriodResult {
  return {
    contractId,
    result: null,
    perLine: [],
    totalScheduledAmortizationDue: 0,
    totalRebateApplied: 0,
    totalShortfall: 0,
    totalRemainingBalance: 0,
    warnings: [],
    diagnostics: { skipReason },
  }
}

/**
 * Compute the per-period tie-in capital evaluation for a contract.
 * For each `ContractCapitalLineItem` row, build a `TieInCapitalConfig`
 * from that line + the contract's first SPEND_REBATE-shaped term (the
 * nested rebate engine), then invoke `calculateTieInCapital(config,
 * periodData, options)`. Aggregate the per-line results into totals.
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
    return serialize(
      emptyResult(input.contractId, "contract not visible to facility"),
    )
  }

  if (
    contract.contractType !== "tie_in" &&
    contract.contractType !== "capital"
  ) {
    return serialize(
      emptyResult(input.contractId, "contract is not tie_in / capital"),
    )
  }

  const lineItems = normalizeCapitalLineItems(contract)
  if (lineItems.length === 0) {
    return serialize(
      emptyResult(input.contractId, "no ContractCapitalLineItem rows"),
    )
  }

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
    return serialize(
      emptyResult(
        input.contractId,
        "no SPEND_REBATE-shaped term to embed as the nested engine",
      ),
    )
  }
  const nestedConfig = buildRebateConfigFromPrisma(candidateTerm)
  if (!nestedConfig || nestedConfig.type !== "SPEND_REBATE") {
    return serialize(
      emptyResult(
        input.contractId,
        "bridge produced non-SPEND_REBATE config",
      ),
    )
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
  // This COG window is shared across all lines because the nested
  // rebate engine is a contract-level construct (one engine, one COG
  // stream, one rebateEarned-per-period). Each per-line invocation
  // re-evaluates the SAME engine against the SAME purchases — the
  // per-line variation is purely on the AMORTIZATION side.
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

  const periodLabel = `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}`
  const periodData: PeriodData = {
    purchases,
    totalSpend,
    periodLabel,
  }

  // ── Per-line iteration ─────────────────────────────────────────
  const periodNumber = input.periodNumber ?? 1
  const carriedForwardShortfall = input.carriedForwardShortfall ?? 0

  const perLine: TieInCapitalPerLineResult[] = lineItems.map((item) =>
    evaluateLine({
      item,
      nestedConfig,
      periodData,
      periodNumber,
      carriedForwardShortfall,
    }),
  )

  // ── Aggregation ────────────────────────────────────────────────
  const totalScheduledAmortizationDue = perLine.reduce(
    (acc, l) => acc + (l.engineResult.amortizationEntry?.amortizationDue ?? 0),
    0,
  )
  const totalRebateApplied = perLine.reduce(
    (acc, l) => acc + l.engineResult.rebateEarned,
    0,
  )
  const totalShortfall = perLine.reduce(
    (acc, l) =>
      acc +
      (l.engineResult.trueUpAdjustment > 0
        ? l.engineResult.trueUpAdjustment
        : 0),
    0,
  )
  const totalRemainingBalance = perLine.reduce(
    (acc, l) => acc + (l.engineResult.amortizationEntry?.closingBalance ?? 0),
    0,
  )
  const warnings = perLine.flatMap((l) => l.engineResult.warnings)

  return serialize({
    contractId: input.contractId,
    // Single-line case: result === perLine[0].engineResult; multi-line
    // case: same — kept for backward shape. Consumers wanting the
    // aggregated picture should read totals + perLine.
    result: perLine[0]?.engineResult ?? null,
    perLine,
    totalScheduledAmortizationDue,
    totalRebateApplied,
    totalShortfall,
    totalRemainingBalance,
    warnings,
    diagnostics: {},
  })
}

function evaluateLine(args: {
  item: NormalizedCapitalLineItem
  nestedConfig: Extract<
    TieInCapitalConfig["rebateEngine"],
    { type: "SPEND_REBATE" }
  >
  periodData: PeriodData
  periodNumber: number
  carriedForwardShortfall: number
}): TieInCapitalPerLineResult {
  const {
    item,
    nestedConfig,
    periodData,
    periodNumber,
    carriedForwardShortfall,
  } = args

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

  const engineResult = calculateTieInCapital(tieInConfig, periodData, {
    periodNumber,
    carriedForwardShortfall,
  })

  return {
    lineItemId: item.id,
    lineDescription: item.description,
    engineResult,
  }
}
