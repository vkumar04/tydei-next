/**
 * The `termsWithTiers.length === 0` (overlay-only) timeline pipeline.
 * Moved verbatim from `lib/actions/contracts/accrual.ts` (2026-08-05
 * decomposition). The orchestrator delegates here when the contract has
 * no walkable spend-dollar / volume tier terms.
 */
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import type { RebateMethodName } from "@/lib/rebates/calculate"
import { buildUnionCategoryWhereClause } from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { resolveOverlayTierRate } from "@/lib/contracts/tier-rebate-label"
import {
  buildMonthlySpendSeriesFromCogRows,
  periodKeyForEval,
} from "./month-buckets"
import type { MarketShareDisplayData } from "./market-share-display"
import type { AccrualContract, OverlayRebateRow } from "./types"

export async function buildOverlayOnlyTimeline(ctx: {
  contract: AccrualContract
  facilityId: string
  isVolumeRebate: boolean
  OVERLAY_TERM_TYPES: ReadonlySet<string>
  overlayRebateRows: OverlayRebateRow[]
  end: Date
  marketShareDisplay: MarketShareDisplayData | null
}) {
  const {
    contract,
    facilityId,
    isVolumeRebate,
    OVERLAY_TERM_TYPES,
    overlayRebateRows,
    end,
    marketShareDisplay,
  } = ctx

  // No spend-dollar tier terms — but overlay rows (carve-out /
  // market-share / compliance / dispatcher accrual) may still exist.
  //
  // bugs.rtfd 2026-06-11 A4 ("STILL not showing"): pre-fix this path
  // rendered ONLY the months that happened to carry ledger rows, with
  // hardcoded spend 0 / cumulativeSpend 0 / tier 0 / rate 0 / empty
  // termLabels / "monthly" reset — so a contract whose ONLY term is
  // market_share showed 2 bare annual rows with $0 spend everywhere
  // while its hero market-share was correct. Three prior fixes
  // (3e24e201, 02081997, 59333750) all repaired the NORMAL walk path;
  // this early return was never updated.
  //
  // The threshold family (market_share / compliance_rebate) accrues on
  // category-scoped COG spend, so this path now runs the SAME scoped
  // monthly bucketing the normal walk uses and merges the overlay
  // accrual into those months.
  //
  // bugs.rtfd 2026-06-12 R3 ("Carve out performance is unchanged here
  // in accruals"): A4 deliberately left carve_out overlay-only — wrong
  // call. A Stryker Mako tie-in carve-out still showed only its 4
  // semi-annual ledger rows, Spend $0 everywhere, "Latest cumulative
  // spend: $0". Carve-outs now get a real monthly Spend series too,
  // mirroring the WRITER's own basis (`recomputeCarveOutAccrualForTerm`
  // in lib/contracts/recompute/carve-out.ts): COG rows whose
  // vendorItemNo matches a ContractPricing line with a carveOutPercent
  // (normalizeSku on BOTH sides — never raw ===), contract-pinned OR
  // vendor-pinned-unmatched (group-aware vendor set), matchStatus
  // on_contract / price_variance, clamped to the term's effective
  // window. Tier / Rate stay 0 ("—"): the ladder is a placeholder and
  // carve-outs earn per-SKU — never resolve tier rates for them.
  // po / payment (count basis) terms keep overlay-only rows.
  const overlayTerms = contract.terms.filter((t) =>
    OVERLAY_TERM_TYPES.has(t.termType),
  )
  const thresholdSpendTerms = overlayTerms.filter(
    (t) =>
      t.termType === "market_share" || t.termType === "compliance_rebate",
  )
  const carveOutTerms = overlayTerms.filter(
    (t) => t.termType === "carve_out",
  )

  type EarlyTimelineRow = {
    month: string
    spend: number
    cumulativeSpend: number
    accruedAmount: number
    tierAchieved: number
    rebatePercent: number
    termContributions: Array<{
      termIndex: number
      accruedAmount: number
      tierAchieved: number
      rebatePercent: number
    }>
    volume: number
    achievedRebateType: string | null
    achievedRebateValue: number
    /** bugs.rtfd 2026-06-13 M: the market share (%) of the evaluation
     * window this month belongs to; null when the contract has no
     * market_share term. */
    marketSharePercent: number | null
  }
  const emptyRow = (month: string): EarlyTimelineRow => ({
    month,
    spend: 0,
    cumulativeSpend: 0,
    accruedAmount: 0,
    tierAchieved: 0,
    rebatePercent: 0,
    termContributions: [],
    volume: 0,
    achievedRebateType: null,
    achievedRebateValue: 0,
    marketSharePercent: null,
  })
  const rowByMonth = new Map<string, EarlyTimelineRow>()

  if (thresholdSpendTerms.length > 0) {
    // Same canonical scoping as the normal walk (A4): union-of-categories
    // pre-filter expanded to drifted COG variants + group-aware vendor
    // set — never raw category `in` or bare vendorId.
    const cogCategoryUniverse = await facilityCogCategoryUniverse(facilityId)
    const unionCategoryWhere = buildUnionCategoryWhereClause(
      thresholdSpendTerms.map((t) => ({
        appliesTo: t.appliesTo,
        categories: t.categories,
      })),
      cogCategoryUniverse,
    )
    const cogRows = await prisma.cOGRecord.findMany({
      where: {
        facilityId,
        vendorId: { in: contractVendorIds(contract) },
        transactionDate: { gte: contract.effectiveDate, lte: end },
        ...unionCategoryWhere,
      },
      select: { transactionDate: true, extendedPrice: true, category: true },
    })
    const series = buildMonthlySpendSeriesFromCogRows(
      cogRows,
      unionCategoryWhere,
      contract.effectiveDate,
      end,
    )
    // Don't render a wall of all-$0 months on a contract with neither
    // in-scope spend nor persisted accrual — keep the blank state.
    const hasAnySpend = series.some((s) => s.spend > 0)
    if (hasAnySpend || overlayRebateRows.length > 0) {
      for (const s of series) {
        const row = emptyRow(s.month)
        row.spend = s.spend
        rowByMonth.set(s.month, row)
      }
    }
  }

  if (carveOutTerms.length > 0) {
    // bugs.rtfd 2026-06-12 R3: writer-basis spend series for carve-out
    // terms. Step 1 — the carved SKU set, exactly the writer's pricing
    // query (`carveOutPercent: { not: null }`).
    const carvedPricingLines = await prisma.contractPricing.findMany({
      where: { contractId: contract.id, carveOutPercent: { not: null } },
      select: { vendorItemNo: true },
    })
    const carvedSkuKeys = new Set(
      carvedPricingLines
        .map((p) => normalizeSku(p.vendorItemNo))
        .filter((k) => k !== ""),
    )
    // No carved lines → the writer earns on nothing; keep overlay-only
    // rows (pre-R3 shape) and skip the COG query entirely.
    if (carvedSkuKeys.size > 0) {
      const vendorIds = contractVendorIds(contract)
      // Step 2 — the writer's COG selection: rows pinned to THIS
      // contract, plus vendor-pinned rows not yet contract-matched
      // (group-aware vendor set — recurring drift class), matched
      // statuses only.
      const carveCogRows = await prisma.cOGRecord.findMany({
        where: {
          facilityId,
          transactionDate: { gte: contract.effectiveDate, lte: end },
          OR: [
            { contractId: contract.id },
            ...(vendorIds.length
              ? [{ contractId: null, vendorId: { in: vendorIds } }]
              : []),
          ],
          matchStatus: { in: ["on_contract", "price_variance"] },
        },
        select: {
          vendorItemNo: true,
          transactionDate: true,
          extendedPrice: true,
        },
      })
      // Step 3 — carved-SKU match (normalizeSku, never raw ===) +
      // per-term effective-window clamp (union across carve-out terms).
      // The writer treats effectiveEnd as INCLUSIVE of its whole day
      // (`endOfDay()` in recompute/carve-out.ts) — mirror that, or a
      // transaction later on the end date would show $0 here while the
      // writer earned on it.
      const endOfDayUTC = (d: Date): number =>
        Date.UTC(
          d.getUTCFullYear(),
          d.getUTCMonth(),
          d.getUTCDate(),
          23,
          59,
          59,
          999,
        )
      const inAnyCarveTermWindow = (d: Date): boolean =>
        carveOutTerms.some(
          (t) =>
            (!t.effectiveStart || d >= t.effectiveStart) &&
            (!t.effectiveEnd || d.getTime() <= endOfDayUTC(t.effectiveEnd)),
        )
      const carvedRows = carveCogRows.filter(
        (r) =>
          r.transactionDate != null &&
          carvedSkuKeys.has(normalizeSku(r.vendorItemNo)) &&
          inAnyCarveTermWindow(r.transactionDate),
      )
      const carveSeries = buildMonthlySpendSeriesFromCogRows(
        carvedRows,
        {}, // SKU scoping already applied — no category filter
        contract.effectiveDate,
        end,
      )
      const hasAnyCarveSpend = carveSeries.some((s) => s.spend > 0)
      if (hasAnyCarveSpend || overlayRebateRows.length > 0) {
        for (const s of carveSeries) {
          // ADD into any month the threshold branch already created so
          // mixed threshold + carve-out contracts don't lose either
          // basis.
          const existing = rowByMonth.get(s.month)
          if (existing) {
            existing.spend += s.spend
          } else {
            const row = emptyRow(s.month)
            row.spend = s.spend
            rowByMonth.set(s.month, row)
          }
        }
      }
    }
  }

  // Term attribution mirrors the normal path's overlay labels: every
  // overlay term gets a stable index (contract order) so contributions
  // and labels line up in the per-term breakout.
  const overlayIndexByTermId = new Map(
    overlayTerms.map((t, i) => [t.id, i] as const),
  )
  const earlyTermLabels = overlayTerms.map((t, i) => ({
    termIndex: i,
    termName: t.termName ?? "Rebate term",
    evaluationPeriod: t.evaluationPeriod ?? "annual",
  }))

  for (const cr of overlayRebateRows) {
    if (!cr.payPeriodEnd) continue
    const monthKey = `${cr.payPeriodEnd.getUTCFullYear()}-${String(
      cr.payPeriodEnd.getUTCMonth() + 1,
    ).padStart(2, "0")}`
    const earned = Number(cr.rebateEarned ?? 0)
    const termId = cr.notes?.match(/term:(\S+)/)?.[1] ?? null
    const tierAchieved = Number(cr.notes?.match(/tier (\d+)/)?.[1] ?? 0)
    const overlayTerm = termId
      ? contract.terms.find((t) => t.id === termId)
      : undefined
    // A2 helper: percent tiers scale fraction→percent; dollar tier types
    // stay 0 (never render $ as %).
    const overlayRate = resolveOverlayTierRate(overlayTerm, tierAchieved)
    const termIndex = termId
      ? (overlayIndexByTermId.get(termId) ?? null)
      : null

    // Keep accrual months with no spend: append a row outside the COG
    // series range instead of dropping the dollars.
    let target = rowByMonth.get(monthKey)
    if (!target) {
      target = emptyRow(monthKey)
      rowByMonth.set(monthKey, target)
    }
    target.accruedAmount += earned
    if (termIndex !== null && earned > 0) {
      const existing = target.termContributions.find(
        (c) => c.termIndex === termIndex,
      )
      if (existing) {
        existing.accruedAmount += earned
        if (tierAchieved > existing.tierAchieved) {
          existing.tierAchieved = tierAchieved
          existing.rebatePercent = overlayRate
        }
      } else {
        target.termContributions.push({
          termIndex,
          accruedAmount: earned,
          tierAchieved,
          rebatePercent: overlayRate,
        })
      }
    }
    // Row headline: best achieved tier wins (same tiebreak the walk
    // uses — higher tier, then higher rate). Carve-out / po / payment
    // notes carry no `tier N`, so their rows keep tier 0 / rate 0 (A1).
    if (
      tierAchieved > target.tierAchieved ||
      (tierAchieved === target.tierAchieved &&
        overlayRate > target.rebatePercent)
    ) {
      const achievedTier = overlayTerm?.tiers.find(
        (t) => t.tierNumber === tierAchieved,
      )
      target.tierAchieved = tierAchieved
      target.rebatePercent = overlayRate
      target.achievedRebateType = achievedTier?.rebateType ?? null
      target.achievedRebateValue = achievedTier
        ? Number(achievedTier.rebateValue)
        : 0
    }
  }

  // bugs.rtfd 2026-06-13 M: market-share visibility on the early path.
  // Persisted overlay rows above stay authoritative; this only (1)
  // stamps each month with its window's share for the Market Share
  // column and (2) keeps the term visible on windows the writer never
  // persisted (below-threshold → $0 payment → no row): the window-end
  // month gets a $0 contribution carrying the share-derived tier/rate.
  if (marketShareDisplay) {
    for (const [m, share] of marketShareDisplay.shareByMonth) {
      const row = rowByMonth.get(m)
      if (row) row.marketSharePercent = share
    }
    for (const we of marketShareDisplay.windowEnds) {
      const termIndex = overlayIndexByTermId.get(we.termId)
      if (termIndex === undefined) continue
      let target = rowByMonth.get(we.month)
      if (!target) {
        target = emptyRow(we.month)
        target.marketSharePercent =
          marketShareDisplay.shareByMonth.get(we.month) ?? null
        rowByMonth.set(we.month, target)
      }
      const existing = target.termContributions.find(
        (c) => c.termIndex === termIndex,
      )
      // A persisted writer row already represents this window — never
      // second-guess the ledger with the display recompute.
      if (existing) continue
      target.termContributions.push({
        termIndex,
        accruedAmount: 0,
        tierAchieved: we.tierAchieved,
        rebatePercent: we.rebatePercent,
      })
      // Single-term early-path UIs render the HEADLINE columns, not
      // the per-term breakdown — surface the window's tier/rate there
      // too (tier 0 keeps the "—" rate by construction).
      if (
        we.tierAchieved > target.tierAchieved ||
        (we.tierAchieved === target.tierAchieved &&
          we.rebatePercent > target.rebatePercent)
      ) {
        const msTerm = contract.terms.find((t) => t.id === we.termId)
        const achievedTier = msTerm?.tiers.find(
          (t) => t.tierNumber === we.tierAchieved,
        )
        target.tierAchieved = we.tierAchieved
        target.rebatePercent = we.rebatePercent
        target.achievedRebateType = achievedTier?.rebateType ?? null
        target.achievedRebateValue = achievedTier
          ? Number(achievedTier.rebateValue)
          : 0
      }
    }
  }

  const earlyRows = Array.from(rowByMonth.values()).sort((a, b) =>
    a.month < b.month ? -1 : 1,
  )
  if (earlyRows.length === 0) {
    // Nothing to show — keep the exact pre-A4 blank shape.
    return serialize({
      rows: [],
      method: "cumulative" as RebateMethodName,
      termLabels: [] as Array<{
        termIndex: number
        termName: string
        evaluationPeriod: string
      }>,
      cumulativeReset: "monthly" as const,
      isVolumeRebate,
    })
  }

  // Cadence: copy the normal path's mapping exactly — a single term
  // keeps its evaluation period (monthly / quarterly / semi_annual pass
  // through; anything else is annual); multi-term falls back to
  // lifetime. Do NOT drop semi_annual (recurring regression class).
  const earlyEval: "monthly" | "quarterly" | "semi_annual" | "annual" | "lifetime" =
    overlayTerms.length === 1
      ? overlayTerms[0].evaluationPeriod === "monthly" ||
        overlayTerms[0].evaluationPeriod === "quarterly" ||
        overlayTerms[0].evaluationPeriod === "semi_annual"
        ? overlayTerms[0].evaluationPeriod
        : "annual"
      : "lifetime"
  let earlyRunningCumulative = 0
  let earlyPeriodKey: string | null = null
  for (const r of earlyRows) {
    const pKey = periodKeyForEval(r.month, earlyEval)
    if (pKey !== earlyPeriodKey) {
      earlyPeriodKey = pKey
      earlyRunningCumulative = 0
    }
    earlyRunningCumulative += r.spend
    r.cumulativeSpend = earlyRunningCumulative
  }

  return serialize({
    rows: earlyRows,
    method: (overlayTerms[0]?.rebateMethod ??
      "cumulative") as RebateMethodName,
    termLabels: earlyTermLabels,
    cumulativeReset: earlyEval,
    isVolumeRebate,
  })
}
