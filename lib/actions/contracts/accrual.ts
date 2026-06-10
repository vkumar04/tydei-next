"use server"

/**
 * Monthly accrual timeline for one contract.
 *
 * Extracted from lib/actions/contracts.ts during subsystem F5 (tech
 * debt split). Re-exported from there for backward-compat.
 *
 * Charles 2026-04-26 #62: split the auth + contract-resolution out
 * of the body so vendors can read the same timeline scoped through
 * their session via `getVendorAccrualTimeline` below. The body is
 * facility-id-pinned (COG queries hang off facilityId), but the
 * contract's primary facility is the same data point in either
 * scope, so the inner helper is reusable.
 */
import { Prisma } from "@/lib/generated/prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility, requireVendor } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  buildMonthlyAccruals,
  buildEvaluationPeriodAccruals,
  type EvaluationPeriod,
  type MonthlySpend,
  type MultiTermTimelineRow,
  type TermAccrualConfig,
} from "@/lib/contracts/accrual"
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"
import { calculateCumulative, calculateMarginal } from "@/lib/rebates/calculate"
import { contractTypeEarnsRebates } from "@/lib/contract-definitions"
import { serialize } from "@/lib/serialize"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"
import { facilityCogCategoryUniverse } from "@/lib/contracts/cog-category-universe"
import { scaleRebateValueForEngine } from "@/lib/rebates/calculate"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"

export async function getAccrualTimeline(contractId: string) {
  const { facility } = await requireFacility()

  // Charles audit round-11 BLOCKER: scope by ownership.
  const contract = await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })
  return _buildAccrualTimelineForContract(contract, facility.id)
}

/**
 * Vendor-scoped read of the accrual timeline. The vendor session
 * authorizes on `Contract.vendorId === session.vendor.id`; the COG
 * query underneath still keys off the contract's primary facilityId
 * (the canonical "this contract's spend lives at this facility"
 * pivot — same one the facility-side caller uses).
 *
 * Charles 2026-04-26 #62: paired with the new vendor Accruals tab in
 * `vendor-contract-detail-client.tsx` to bring the vendor surface to
 * facility parity.
 */
export async function getVendorAccrualTimeline(contractId: string) {
  const { vendor } = await requireVendor()
  const contract = await prisma.contract.findFirstOrThrow({
    where: { id: contractId, vendorId: vendor.id },
    include: {
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
    },
  })
  return _buildAccrualTimelineForContract(contract, contract.facilityId)
}

type _AccrualContract = Prisma.ContractGetPayload<{
  include: { terms: { include: { tiers: true } } }
}>

async function _buildAccrualTimelineForContract(
  contract: _AccrualContract,
  facilityId: string | null,
) {
  // Bug 3 (2026-05-17): flag the timeline as volume-driven if ANY term
  // is a volume_rebate. The UI uses this to surface a "Volume (units)"
  // column alongside Spend so users can see the qty that drove tier
  // achievement.
  const isVolumeRebate = contract.terms.some(
    (t) => t.termType === "volume_rebate",
  )

  if (!facilityId) {
    // No primary facility — fall through with empty result. Matches
    // the early-return shape below.
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

  // Charles R5.6: pricing-only contracts are not rebate-bearing. The
  // accrual ledger must be empty for them — no phantom rows from COG.
  if (!contractTypeEarnsRebates(contract.contractType)) {
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

  // Charles R5.29: iterate all terms and sum per-month accruals so the
  // timeline matches what `recomputeAccrualForContract` writes to the
  // Rebate ledger. Pre-fix, multi-term contracts showed only the first
  // term's accrued values in the Performance tab timeline.
  //
  // 2026-06-09 ("market share rebate performance is not calculating
  // correctly or showing the rate"): market_share / compliance_rebate
  // tiers store PERCENT thresholds (0-100) in spendMin — walking dollar
  // spend against them is the recurring type-confusion class (spend ≫ 100
  // always "achieves" the top tier). Exclude them from the tier walk;
  // their real accrual is persisted by the threshold writer as
  // `[auto-threshold-accrual]` Rebate rows and overlaid below.
  const termsWithTiers = contract.terms.filter(
    (t) =>
      t.tiers.length > 0 &&
      t.termType !== "market_share" &&
      t.termType !== "compliance_rebate",
  )
  // 2026-06-09 (Charles "contracts on the vendor side is broken"): a
  // carve-out contract's tiers are PHANTOM (rebateValue 0 scaffolds), so the
  // tier engine accrues $0 for them. The real accrual for carve-out AND
  // threshold (market_share / compliance) terms is persisted by their
  // dedicated writers — the doctrine-canonical earned source. Overlay those
  // rows into the timeline buckets below.
  const hasOverlayTerm = contract.terms.some(
    (t) =>
      t.termType === "carve_out" ||
      t.termType === "market_share" ||
      t.termType === "compliance_rebate",
  )
  const carveOutRebateRows = hasOverlayTerm
    ? await prisma.rebate.findMany({
        where: {
          contractId: contract.id,
          OR: [
            { notes: { startsWith: "[auto-carve-out-accrual]" } },
            { notes: { startsWith: "[auto-threshold-accrual]" } },
          ],
        },
        select: { rebateEarned: true, payPeriodEnd: true },
      })
    : []
  if (termsWithTiers.length === 0) {
    // No spend-dollar tier terms — but overlay rows (carve-out /
    // market-share / compliance accrual) may still exist. Render them as a
    // minimal monthly timeline instead of a blank card.
    if (carveOutRebateRows.length > 0) {
      const byMonth = new Map<string, number>()
      for (const r of carveOutRebateRows) {
        if (!r.payPeriodEnd) continue
        const key = `${r.payPeriodEnd.getUTCFullYear()}-${String(
          r.payPeriodEnd.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.rebateEarned ?? 0))
      }
      const rows = Array.from(byMonth.entries())
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([month, accruedAmount]) => ({
          month,
          spend: 0,
          cumulativeSpend: 0,
          accruedAmount,
          tierAchieved: 0,
          rebatePercent: 0,
          termContributions: [] as Array<{
            termIndex: number
            accruedAmount: number
            tierAchieved: number
            rebatePercent: number
          }>,
          volume: 0,
          achievedRebateType: null as string | null,
          achievedRebateValue: 0,
        }))
      return serialize({
        rows,
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

  // Charles W1.S — scale `rebateValue` by 100 at the Prisma boundary for
  // `percent_of_spend` tiers. `ContractTier.rebateValue` is stored as a
  // fraction (0.03 = 3%), but the rebate engine in
  // `lib/rebates/calculate.ts` expects integer percent (3 = 3%).
  // Without this scaling, the Accrual Timeline's Rate column rendered the
  // raw fraction (e.g. "0.03%" for a 3% tier) and the Accrued column was
  // 100× too small. Mirrors the convention in
  // `lib/rebates/calculate.ts#computeRebateFromPrismaTiers` and
  // `lib/contracts/tier-rebate-label.ts` — scale at the boundary, not in
  // the engine. See CLAUDE.md "Rebate engine units" rule.
  // Bug #16 (2026-05-08, Vick screenshots): the accrual-timeline rate
  // column was rendering raw `tier.rebateValue` for `fixed_rebate`
  // tiers, so a $50,000 / $500,000 flat rebate showed up as "50000%" /
  // "500000%" in the Rate column and the Accrued column was billions
  // of dollars. The legacy engine in `lib/rebates/calculate.ts`
  // already short-circuits to `tier.fixedRebateAmount` when set
  // (`shared/cumulative.ts:20`), but the mapper here never populated
  // that field. For `fixed_rebate`, route the dollar value through
  // `fixedRebateAmount` and force `rebateValue` to 0 so the engine's
  // percent math returns 0 dollars on its own and the Rate column
  // shows 0% (a fixed rebate has no percent rate by definition).
  //
  // For `fixed_rebate_per_unit` / `per_procedure_rebate` tiers, the
  // spend-accrual timeline is the wrong surface to render them on
  // (those rebates are unit-driven, not spend-driven), but until the
  // timeline gets a per-rebate-type viewer we at least zero out the
  // rate so it doesn't display absurd percentages — accrual on those
  // termTypes is computed via the dedicated VOLUME / per-use writers
  // in `lib/contracts/recompute/`, not this timeline.
  const isFixedDollarRebateType = (rt: string | null | undefined): boolean =>
    rt === "fixed_rebate" ||
    rt === "fixed_rebate_per_unit" ||
    rt === "per_procedure_rebate"

  const termConfigs: TermAccrualConfig[] = termsWithTiers.map((term) => {
    const tiers: TierLike[] = term.tiers.map((t) => {
      const isFixed = isFixedDollarRebateType(t.rebateType)
      const isTrueFixedRebate = t.rebateType === "fixed_rebate"
      return {
        tierNumber: t.tierNumber,
        tierName: t.tierName ?? null,
        spendMin: Number(t.spendMin),
        spendMax: t.spendMax ? Number(t.spendMax) : null,
        // Force 0 for any non-percent rebate type so the Rate column
        // never renders a dollar amount as a percent. Percent tiers
        // keep the existing × 100 fraction-to-percent scaling.
        rebateValue: isFixed
          ? 0
          : scaleRebateValueForEngine(t.rebateValue, t.rebateType),
        // Only `fixed_rebate` is truly a flat-dollar tier; route its
        // dollars through `fixedRebateAmount` so the engine pays it on
        // tier qualification. Per-unit / per-procedure types remain
        // null — those are unit-driven, not flat, and shouldn't be
        // paid out here.
        fixedRebateAmount: isTrueFixedRebate ? Number(t.rebateValue) : null,
      }
    })
    const evaluationPeriod: EvaluationPeriod =
      term.evaluationPeriod === "monthly" ||
      term.evaluationPeriod === "quarterly" ||
      term.evaluationPeriod === "semi_annual"
        ? term.evaluationPeriod
        : "annual"
    return {
      tiers,
      method: (term.rebateMethod ?? "cumulative") as RebateMethodName,
      evaluationPeriod,
      effectiveStart: term.effectiveStart ?? null,
      effectiveEnd: term.effectiveEnd ?? null,
      // 2026-06-09: thread the baseline like the writer does so the
      // retroactive period re-budget below applies the same
      // baseline-above math (Bug #22 rule: spendBaseline > 0 → tiers
      // evaluate max(0, periodSpend − proRatedBaseline)).
      spendBaseline:
        term.spendBaseline === null || term.spendBaseline === undefined
          ? null
          : Number(term.spendBaseline),
      baselineType: term.baselineType ?? null,
    }
  })

  // Method reported alongside `rows` is the primary (first) term's —
  // used for the "cumulative vs marginal" label on the timeline header.
  const method: RebateMethodName =
    (termsWithTiers[0].rebateMethod ?? "cumulative") as RebateMethodName

  const end = new Date(
    Math.min(new Date().getTime(), contract.expirationDate.getTime()),
  )

  // Charles W1.U-A — fetch COG once with a union-of-categories pre-filter
  // so the in-memory partition below receives only rows we might want.
  // When any term is all-products the union is {} and we fall back to
  // the vendor-wide query (pre-W1.U behavior).
  const termScopes = termsWithTiers.map((term) => ({
    appliesTo: term.appliesTo,
    categories: term.categories,
  }))
  // 2026-06-08: expand to drifted COG category variants (canonical match) so
  // the timeline doesn't drop case/word-order-different rows. Reused for the
  // union SQL fetch, per-term in-memory partition, and the volume fallback.
  const cogCategoryUniverse = await facilityCogCategoryUniverse(facilityId)
  const unionCategoryWhere = buildUnionCategoryWhereClause(
    termScopes,
    cogCategoryUniverse,
  )

  // Charles R5.12 — bucket spend by the actual transaction date, not the
  // DB insertion timestamp. Using `createdAt` collapsed every seeded
  // record into the single month the seed ran, which made the Accrual
  // Timeline and Performance Spend-by-Period panels show all activity in
  // one column and every other month as $0.
  const cogRecords = await prisma.cOGRecord.findMany({
    where: {
      facilityId,
      // 2026-06-09 audit: group-aware vendor set (recurring drift class) —
      // bare contract.vendorId blanked the timeline on grouped contracts
      // whose spend sits under member vendors (prod: $0 shown vs $561,207
      // writer basis). Same canonical helper the recompute writer uses.
      vendorId: { in: contractVendorIds(contract) },
      transactionDate: {
        gte: contract.effectiveDate,
        lte: end,
      },
      ...unionCategoryWhere,
    },
    select: {
      transactionDate: true,
      extendedPrice: true,
      category: true,
    },
  })

  // Helper: build a YYYY-MM monthly spend series from the fetched rows
  // filtered by an optional category set. Each term calls this with its
  // own filter so its tier math sees only the slice it is scoped to.
  const buildSeries = (
    rows: typeof cogRecords,
    categoryFilter: ReturnType<typeof buildCategoryWhereClause>,
  ): MonthlySpend[] => {
    const categoryIn = categoryFilter.category?.in ?? null
    const categorySet = categoryIn ? new Set(categoryIn) : null

    const byMonth = new Map<string, number>()
    for (const r of rows) {
      const d = r.transactionDate
      if (!d) continue
      if (categorySet && !categorySet.has(r.category ?? "")) continue
      const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
      byMonth.set(key, (byMonth.get(key) ?? 0) + Number(r.extendedPrice))
    }

    const series: MonthlySpend[] = []
    const cursor = new Date(
      Date.UTC(
        contract.effectiveDate.getUTCFullYear(),
        contract.effectiveDate.getUTCMonth(),
        1,
      ),
    )
    const lastMonth = new Date(
      Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1),
    )
    while (cursor <= lastMonth) {
      const key = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`
      series.push({ month: key, spend: byMonth.get(key) ?? 0 })
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
    return series
  }

  // Per-term accrual series — each term sees ONLY the categories it is
  // scoped to (W1.U-A). Mirrors `recomputeAccrualForContract` so the
  // on-the-fly timeline and the persisted Rebate ledger agree.
  const perTermResults = termsWithTiers.map((term, idx) => {
    const termScope = { appliesTo: term.appliesTo, categories: term.categories }
    const termCategoryWhere = buildCategoryWhereClause(
      termScope,
      cogCategoryUniverse,
    )
    const series = buildSeries(cogRecords, termCategoryWhere)
    const rows = buildMonthlyAccruals(
      series,
      termConfigs[idx].tiers,
      termConfigs[idx].method,
      termConfigs[idx].evaluationPeriod,
    )
    return { termIndex: idx, series, rows, config: termConfigs[idx] }
  })

  // 2026-06-09 (Charles "much larger rebate numbers vs performance" — prod
  // audit Bug 1): the per-month tier walk is NOT retroactive. When
  // cumulative spend crosses a tier mid-period, months already accrued at
  // 0%/a lower rate were never trued up, so the timeline under-reported vs
  // the persisted ledger on an IDENTICAL COG basis (live Arthrex:
  // $96,264.06 shown vs $421,341.49 booked). The earlier annual-only
  // re-budget summed the same under-counted monthly slices, so it didn't
  // help. For EVERY non-monthly cadence, recompute each evaluation window
  // through the WRITER's engine (buildEvaluationPeriodAccruals — whole-
  // window spend, retroactive, baseline-aware) and re-budget the window's
  // earned into its period-end month. Mid-window months keep their
  // tier/rate progress columns with $0 accrued — matching the ledger,
  // which books at period close. Timeline ≡ ledger by construction.
  const nowForBudget = new Date()
  for (const r of perTermResults) {
    if (r.config.evaluationPeriod === "monthly" || r.rows.length === 0) {
      continue
    }
    const term = termsWithTiers[r.termIndex]
    const windowAnchor = term.effectiveStart ?? contract.effectiveDate
    const termWindowEnd = term.effectiveEnd
      ? new Date(
          Math.min(
            nowForBudget.getTime(),
            term.effectiveEnd.getTime(),
            end.getTime(),
          ),
        )
      : new Date(Math.min(nowForBudget.getTime(), end.getTime()))
    const hasBaseline =
      r.config.spendBaseline != null && r.config.spendBaseline > 0
    const buckets = buildEvaluationPeriodAccruals(
      r.series,
      r.config.tiers,
      r.config.method,
      r.config.evaluationPeriod,
      windowAnchor,
      {
        boundedUntil: termWindowEnd,
        spendBaseline: hasBaseline ? (r.config.spendBaseline ?? null) : null,
        growthBased: hasBaseline,
      },
    )
    // Zero the per-month slices (tier/rate progress columns stay), then
    // land each completed window's retroactive earned on its period-end
    // month. Incomplete windows (periodEnd in the future) stay $0 — the
    // rebate isn't earned until the period closes, same as the ledger.
    for (let i = 0; i < r.rows.length; i++) {
      r.rows[i] = { ...r.rows[i], accruedAmount: 0 }
    }
    const rowIdxByMonth = new Map(r.rows.map((row, i) => [row.month, i]))
    let bucketedSpend = 0
    for (const b of buckets) {
      bucketedSpend += b.totalSpend
      if (b.rebateEarned <= 0) continue
      if (b.periodEnd.getTime() > nowForBudget.getTime()) continue
      const endKey = `${b.periodEnd.getUTCFullYear()}-${String(
        b.periodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const idx = rowIdxByMonth.get(endKey) ?? r.rows.length - 1
      r.rows[idx] = {
        ...r.rows[idx],
        accruedAmount: r.rows[idx].accruedAmount + b.rebateEarned,
        tierAchieved: b.tierAchieved,
        rebatePercent: b.rebatePercent,
      }
    }
    // Open / partial TAIL window — the engine (like the writer) drops a
    // window whose natural end exceeds boundedUntil, so a contract that
    // expired mid-window (or whose current window is still running) would
    // show $0 for that stretch. Keep the 2026-04-25 display intent: show
    // the tail's accrued-TO-DATE on the latest in-range month. Closed
    // windows above stay ≡ ledger.
    const seriesSpend = r.series.reduce((s, m) => s + m.spend, 0)
    const tailSpend = Math.max(0, seriesSpend - bucketedSpend)
    if (tailSpend > 0 && r.rows.length > 0) {
      const widthMonths =
        r.config.evaluationPeriod === "quarterly"
          ? 3
          : r.config.evaluationPeriod === "semi_annual"
            ? 6
            : 12
      const proRated =
        hasBaseline && r.config.spendBaseline
          ? r.config.spendBaseline * (widthMonths / 12)
          : 0
      const tailTierSpend = Math.max(0, tailSpend - proRated)
      const res =
        r.config.method === "marginal"
          ? calculateMarginal(tailTierSpend, r.config.tiers)
          : calculateCumulative(tailTierSpend, r.config.tiers)
      if (res.rebateEarned > 0) {
        const last = r.rows.length - 1
        r.rows[last] = {
          ...r.rows[last],
          accruedAmount: r.rows[last].accruedAmount + res.rebateEarned,
          tierAchieved: res.tierAchieved,
          rebatePercent: res.rebatePercent,
        }
      }
    }
  }

  const monthsTimeline =
    perTermResults[0]?.series.map((s) => s.month) ?? []

  // Bug 3 (2026-05-17): build a per-month volume series for the UI.
  // Mirrors the volume-rebate writer (`lib/contracts/recompute/volume.ts`):
  //   - CPT mode (term has cptCodes): count distinct case+CPT
  //     occurrences from Case.procedures within the month.
  //   - COG-fallback (no cptCodes): sum COGRecord.quantity within the
  //     month, scoped to the term's category filter.
  // We sum across every volume_rebate term so a month's "Volume" reads
  // as the total qty that drove ANY volume tier this month.
  const volumeByMonth = new Map<string, number>()
  if (isVolumeRebate) {
    const volumeTerms = termsWithTiers.filter(
      (t) => t.termType === "volume_rebate",
    )
    const cptVolumeTerms = volumeTerms.filter(
      (t) => Array.isArray(t.cptCodes) && t.cptCodes.length > 0,
    )
    const cogVolumeTerms = volumeTerms.filter(
      (t) => !t.cptCodes || t.cptCodes.length === 0,
    )

    // CPT-mode buckets: load cases once, fan out per term + dedupe by
    // (caseId, cptCode) within each (term, month) bucket so the count
    // matches what the writer persists.
    if (cptVolumeTerms.length > 0) {
      const cases = await prisma.case.findMany({
        where: {
          facilityId,
          dateOfSurgery: { gte: contract.effectiveDate, lte: end },
        },
        select: {
          id: true,
          dateOfSurgery: true,
          procedures: { select: { cptCode: true } },
        },
      })
      for (const term of cptVolumeTerms) {
        const allowed = new Set(term.cptCodes)
        const seenPerMonth = new Map<string, Set<string>>()
        for (const c of cases) {
          const d = c.dateOfSurgery
          if (!d) continue
          if (term.effectiveStart && d < term.effectiveStart) continue
          if (term.effectiveEnd && d > term.effectiveEnd) continue
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
          let seen = seenPerMonth.get(key)
          if (!seen) {
            seen = new Set<string>()
            seenPerMonth.set(key, seen)
          }
          for (const p of c.procedures) {
            if (!allowed.has(p.cptCode)) continue
            seen.add(`case:${c.id}|cpt:${p.cptCode}`)
          }
        }
        for (const [m, set] of seenPerMonth) {
          volumeByMonth.set(m, (volumeByMonth.get(m) ?? 0) + set.size)
        }
      }
    }

    // COG-fallback: sum COGRecord.quantity per month across in-scope
    // categories. Reload COG with `quantity` (the upper-block select
    // intentionally omits it) — one extra query is fine, only volume
    // contracts hit this path.
    if (cogVolumeTerms.length > 0) {
      const unionWhereForVolume = buildUnionCategoryWhereClause(
        cogVolumeTerms.map((t) => ({
          appliesTo: t.appliesTo,
          categories: t.categories,
        })),
        cogCategoryUniverse,
      )
      const cogVolRows = await prisma.cOGRecord.findMany({
        where: {
          facilityId,
          vendorId: contract.vendorId,
          transactionDate: { gte: contract.effectiveDate, lte: end },
          ...unionWhereForVolume,
        },
        select: {
          transactionDate: true,
          quantity: true,
          category: true,
        },
      })
      for (const term of cogVolumeTerms) {
        const termScope = {
          appliesTo: term.appliesTo,
          categories: term.categories,
        }
        const where = buildCategoryWhereClause(termScope, cogCategoryUniverse)
        const categoryIn = where.category?.in ?? null
        const categorySet = categoryIn ? new Set(categoryIn) : null
        for (const r of cogVolRows) {
          const d = r.transactionDate
          if (!d) continue
          if (term.effectiveStart && d < term.effectiveStart) continue
          if (term.effectiveEnd && d > term.effectiveEnd) continue
          if (categorySet && !categorySet.has(r.category ?? "")) continue
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
          volumeByMonth.set(key, (volumeByMonth.get(key) ?? 0) + (r.quantity ?? 0))
        }
      }
    }
  }

  // Charles 2026-04-23 — the Cumulative column previously ran a
  // lifetime running sum across all months, which made a quarterly-
  // eval contract look like tier qualification was using lifetime
  // spend even though the engine's `windowSpend` already resets at
  // each period boundary. Users (Charles, Preferred Supplier-Provider
  // Rebate Agreement) flagged this as a math bug: "the spend resets
  // it is not based on the cumulative at that point. So after the
  // quarter they have to spend 200K to get to the next year."
  //
  // Fix the display to match the math: for single-term contracts we
  // reset the cumulative at the same period boundaries the engine
  // uses (monthly → every month; quarterly → at each calendar
  // quarter; semi_annual → at H1/H2; annual → at year start). For
  // multi-term contracts we keep the lifetime cumulative, since each
  // term may run on a different cadence and there's no single correct
  // reset point.
  const primaryEval =
    termsWithTiers.length === 1
      ? termConfigs[0].evaluationPeriod
      : ("lifetime" as const)
  function periodKeyFor(month: string): string {
    const [y, m] = month.split("-").map((n) => Number(n))
    if (primaryEval === "monthly") return month
    if (primaryEval === "quarterly") {
      const q = Math.floor((m - 1) / 3) + 1
      return `${y}-Q${q}`
    }
    if (primaryEval === "semi_annual") {
      const h = m <= 6 ? 1 : 2
      return `${y}-H${h}`
    }
    if (primaryEval === "annual") return `${y}`
    return "lifetime"
  }
  let runningCumulative = 0
  let currentPeriodKey: string | null = null
  type TimelineRowWithVolume = MultiTermTimelineRow & {
    volume: number
    /** Bug 3: the achieved tier's rebate type for the headline term, so
     * the UI's Rate column can render `$X / period` for `fixed_rebate`,
     * `$X / unit` for `fixed_rebate_per_unit`, etc. instead of "—" for
     * any non-percent tier. */
    achievedRebateType: string | null
    /** Raw fractional/dollar `rebateValue` from the achieved tier (NOT
     * scaled by 100 — that scaling is only for percent_of_spend tiers
     * passed to the engine). Used by the UI to render unit/flat dollar
     * labels for non-percent tiers. */
    achievedRebateValue: number
  }
  const rows: TimelineRowWithVolume[] = monthsTimeline.map((month, i) => {
    let totalSpend = 0
    let totalAccrued = 0
    let bestTier = 0
    let bestPercent = 0
    let bestContribution = -1
    let bestRebateType: string | null = null
    let bestRebateValue = 0
    const contributions: MultiTermTimelineRow["termContributions"] = []

    const monthStart = monthKeyToDate(month)
    const monthEnd = monthKeyEndOfMonth(month)

    for (const { termIndex, rows: tRows, config, series } of perTermResults) {
      const sourceTerm = termsWithTiers[termIndex]
      const startOk =
        config.effectiveStart == null || config.effectiveStart <= monthEnd
      const endOk =
        config.effectiveEnd == null || config.effectiveEnd >= monthStart
      if (!startOk || !endOk) continue

      const row = tRows[i]
      const entry = series[i]
      if (!row || !entry) continue
      totalSpend += entry.spend

      // Charles 2026-04-25: previously this `continue`d on
      // accruedAmount <= 0, which dropped tier visibility for any
      // month with $0 accrual. After the annual-eval re-budget
      // (above), mid-year months legitimately have accrual=0 but
      // still need their tier displayed in the Tier column. Always
      // record the contribution; only the contributions list (which
      // the UI uses to break down "who paid what this month") skips
      // zero rows so we don't visually clutter the breakdown.
      totalAccrued += row.accruedAmount
      if (row.accruedAmount > 0) {
        contributions.push({
          termIndex,
          accruedAmount: row.accruedAmount,
          tierAchieved: row.tierAchieved,
          rebatePercent: row.rebatePercent,
        })
      }
      // Pick the term with the highest tier as the row's headline
      // tier. For zero-accrual months (annual-eval pre-year-end), we
      // still want the term's CURRENT tier on the row so the user
      // sees their tracking progress. Tiebreak on rate when tiers
      // match, then on accrual size.
      const tierBeat = row.tierAchieved > bestTier
      const sameTierBetterRate =
        row.tierAchieved === bestTier && row.rebatePercent > bestPercent
      const sameTierBetterAccrual =
        row.tierAchieved === bestTier &&
        row.rebatePercent === bestPercent &&
        row.accruedAmount > bestContribution
      if (tierBeat || sameTierBetterRate || sameTierBetterAccrual) {
        bestContribution = row.accruedAmount
        bestTier = row.tierAchieved
        bestPercent = row.rebatePercent
        const sourceTier = sourceTerm.tiers.find(
          (t) => t.tierNumber === row.tierAchieved,
        )
        bestRebateType = sourceTier?.rebateType ?? null
        bestRebateValue = sourceTier ? Number(sourceTier.rebateValue) : 0
      }
    }

    const pKey = periodKeyFor(month)
    if (pKey !== currentPeriodKey) {
      currentPeriodKey = pKey
      runningCumulative = 0
    }
    runningCumulative += totalSpend
    return {
      month,
      spend: totalSpend,
      cumulativeSpend: runningCumulative,
      accruedAmount: totalAccrued,
      tierAchieved: bestTier,
      rebatePercent: bestPercent,
      termContributions: contributions,
      volume: volumeByMonth.get(month) ?? 0,
      achievedRebateType: bestRebateType,
      achievedRebateValue: bestRebateValue,
    }
  })

  // Tell the UI what reset cadence the Cumulative column uses so the
  // header can label it "Cumulative (quarter-to-date)" etc.
  const cumulativeReset:
    | "monthly"
    | "quarterly"
    | "semi_annual"
    | "annual"
    | "lifetime" = primaryEval

  // 2026-06-09 (Charles "in performance in tie in it is showing accrued
  // rebates on a monthly basis but this is a quarterly contract"): the rows
  // above are emitted one-per-MONTH regardless of cadence — the quarterly
  // `evaluationPeriod` only reset the tier-math window, never the row
  // granularity. Roll the per-month rows up into evaluation-period buckets
  // (one row per quarter / half / year) so a quarterly contract displays
  // quarterly: sum spend + accrued + volume, take the period-end cumulative
  // (rows already reset cumulative per period via periodKeyFor), and keep the
  // best tier/rate achieved in the period. Monthly-eval and multi-term
  // ("lifetime") contracts keep per-month rows. Reuses periodKeyFor so the
  // bucket boundaries match the cumulative-reset logic exactly.
  const displayRows: TimelineRowWithVolume[] =
    primaryEval === "monthly" || primaryEval === "lifetime"
      ? rows
      : (() => {
          const byBucket = new Map<string, TimelineRowWithVolume>()
          const order: string[] = []
          for (const r of rows) {
            const key = periodKeyFor(r.month)
            const prev = byBucket.get(key)
            if (!prev) {
              order.push(key)
              byBucket.set(key, { ...r, month: key })
              continue
            }
            const better =
              r.tierAchieved > prev.tierAchieved ||
              (r.tierAchieved === prev.tierAchieved &&
                r.rebatePercent > prev.rebatePercent)
            byBucket.set(key, {
              ...prev,
              spend: prev.spend + r.spend,
              // period-end running total (cumulative already resets per period)
              cumulativeSpend: r.cumulativeSpend,
              accruedAmount: prev.accruedAmount + r.accruedAmount,
              volume: prev.volume + r.volume,
              tierAchieved: better ? r.tierAchieved : prev.tierAchieved,
              rebatePercent: better ? r.rebatePercent : prev.rebatePercent,
              achievedRebateType: better
                ? r.achievedRebateType
                : prev.achievedRebateType,
              achievedRebateValue: better
                ? r.achievedRebateValue
                : prev.achievedRebateValue,
              termContributions: [
                ...prev.termContributions,
                ...r.termContributions,
              ],
            })
          }
          return order.map((k) => byBucket.get(k)!)
        })()

  // 2026-06-09: overlay the persisted carve-out accrual into the bucketed
  // rows (see hasCarveOutTerm above). Each `[auto-carve-out-accrual]` Rebate
  // row lands in the bucket containing its payPeriodEnd; buckets with no
  // tier-engine row are appended so semi-annual carve accrual outside the
  // COG-spend window still shows. Tier/Rate stay untouched (carve-out has
  // no real tiers).
  if (carveOutRebateRows.length > 0) {
    const byKey = new Map(displayRows.map((r) => [r.month, r]))
    for (const cr of carveOutRebateRows) {
      if (!cr.payPeriodEnd) continue
      const monthKey = `${cr.payPeriodEnd.getUTCFullYear()}-${String(
        cr.payPeriodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const key = periodKeyFor(monthKey)
      const earned = Number(cr.rebateEarned ?? 0)
      const existing = byKey.get(key)
      if (existing) {
        existing.accruedAmount += earned
      } else {
        const synthetic: TimelineRowWithVolume = {
          month: key,
          spend: 0,
          cumulativeSpend: 0,
          accruedAmount: earned,
          tierAchieved: 0,
          rebatePercent: 0,
          termContributions: [],
          volume: 0,
          achievedRebateType: null,
          achievedRebateValue: 0,
        }
        byKey.set(key, synthetic)
        displayRows.push(synthetic)
      }
    }
    // Keep chronological order — bucket keys within one scheme
    // (YYYY-MM / YYYY-QN / YYYY-HN / YYYY) sort lexicographically.
    displayRows.sort((a, b) => (a.month < b.month ? -1 : 1))
  }

  // Per-term labels so the Accrual Timeline UI can render each term's
  // contribution on multi-term contracts instead of collapsing to the
  // "best" term. Without this, a contract with a spend rebate + a
  // category-scoped rebate shows only the dominant rate, which led users
  // to report "it's only pulling from the 1st one" (2026-04-23).
  const termLabels = termsWithTiers.map((t, i) => ({
    termIndex: i,
    termName: t.termName ?? `Term ${i + 1}`,
    evaluationPeriod: t.evaluationPeriod ?? "annual",
  }))

  return serialize({
    rows: displayRows,
    method,
    termLabels,
    cumulativeReset,
    isVolumeRebate,
  })
}

// Local month-key helpers duplicated from `lib/contracts/accrual.ts` —
// the originals are not exported. Keep identical UTC semantics.
function monthKeyToDate(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month - 1, 1))
}

function monthKeyEndOfMonth(key: string): Date {
  const [year, month] = key.split("-").map((n) => Number(n))
  return new Date(Date.UTC(year, month, 0))
}
