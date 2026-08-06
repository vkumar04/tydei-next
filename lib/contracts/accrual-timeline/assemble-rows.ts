/**
 * Final row assembly for the accrual timeline: cumulative-reset walk,
 * overlay merge, market-share stamping, chronological sort, and
 * period-subtotal interleaving. Moved verbatim from
 * `lib/actions/contracts/accrual.ts` (2026-08-05 decomposition).
 */
import type { MultiTermTimelineRow } from "@/lib/contracts/accrual"
import { serialize } from "@/lib/serialize"
import { resolveOverlayTierRate } from "@/lib/contracts/tier-rebate-label"
import {
  monthKeyEndOfMonth,
  monthKeyToDate,
  periodKeyForEval,
} from "./month-buckets"
import type { AssembleRowsContext, TimelineRowWithVolume } from "./types"

export function assembleTimelineRows(ctx: AssembleRowsContext) {
  const {
    contract,
    termsWithTiers,
    VOLUME_WALK_TERM_TYPES,
    termConfigs,
    method,
    monthsTimeline,
    unionSpendByMonth,
    perTermResults,
    volumeByMonth,
    inProgressVolumeByTermMonth,
    volumeDisplayByTermMonth,
    overlayRebateRows,
    marketShareDisplay,
    isVolumeRebate,
  } = ctx

  // Charles 2026-04-23 — the Cumulative column previously ran a
  // lifetime running sum across all months, which made a quarterly-
  // eval contract look like tier qualification was using lifetime
  // spend even though the engine's `windowSpend` already resets at
  // each period boundary. Users (Charles, Preferred Supplier-Provider
  // Rebate Agreement) flagged this as a math bug: "the spend resets
  // it is not based on the cumulative at that point. So after the
  // quarter they have to spend 200K to get to the next year."
  //
  // Fix the display to match the math: reset the cumulative at the same
  // period boundaries the engine uses (monthly → every month; quarterly →
  // each calendar quarter; semi_annual → H1/H2; annual → year start).
  // bugs.rtfd 2026-06-13: when ALL terms share one cadence (e.g. two
  // annual terms), reset on that cadence so "Cumulative" matches the
  // per-period tier qualification ("the math based on the rebate period
  // not the cumulative spend"). Only fall back to lifetime when terms
  // genuinely run on DIFFERENT cadences (no single correct reset point).
  const allSameEval =
    termConfigs.length > 0 &&
    termConfigs.every(
      (c) => c.evaluationPeriod === termConfigs[0].evaluationPeriod,
    )
  const primaryEval = allSameEval
    ? termConfigs[0].evaluationPeriod
    : ("lifetime" as const)
  function periodKeyFor(month: string): string {
    // Shared with the overlay-only early path (A4) — see
    // `periodKeyForEval` at module level.
    return periodKeyForEval(month, primaryEval)
  }
  let runningCumulative = 0
  let currentPeriodKey: string | null = null
  // `TimelineRowWithVolume` (the UI row contract) lives in ./types.
  const rows: TimelineRowWithVolume[] = monthsTimeline.map((month, i) => {
    // bugs.rtfd 2026-06-13: union spend for the month, counted ONCE (no
    // cross-term double-count). Accrual still sums per term below.
    const totalSpend = unionSpendByMonth.get(month) ?? 0
    let totalAccrued = 0
    // bugs.rtfd 2026-06-13: sum the growth-baseline cut the per-term
    // evaluation-period walk stamped on this month (only the period-end
    // month of a growth term is non-zero).
    let totalGrowthBaseline = 0
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
      // (display spend is the deduplicated union total, set above — do
      // NOT add per-term spend here or multi-term contracts double-count.)

      // Charles 2026-04-25: previously this `continue`d on
      // accruedAmount <= 0, which dropped tier visibility for any
      // month with $0 accrual. After the annual-eval re-budget
      // (above), mid-year months legitimately have accrual=0 but
      // still need their tier displayed in the Tier column. Always
      // record the contribution; only the contributions list (which
      // the UI uses to break down "who paid what this month") skips
      // zero rows so we don't visually clutter the breakdown.
      //
      // 2026-06-10: volume-family terms' (volume_rebate / rebate_per_use /
      // capitated_pricing_rebate) accrual comes from the persisted
      // `[auto-volume-accrual]` overlay rows (the canonical earned source);
      // the walk keeps providing their tier/rate/volume display but must
      // not contribute accrual or it would double-count with the overlay.
      //
      // bug-bash 2026-06-11 follow-up F2: months inside the current
      // UNCLOSED evaluation window get the display-only in-progress delta
      // computed above (writer's own helper on window-cumulative units),
      // so volume terms walk live like spend terms do. Months covered by
      // persisted overlay rows carry NO in-progress entry by construction
      // — no double count.
      const isVolumeWalkTerm = VOLUME_WALK_TERM_TYPES.has(sourceTerm.termType)
      const inProgressVolume = isVolumeWalkTerm
        ? inProgressVolumeByTermMonth.get(sourceTerm.id)?.get(month)
        : undefined
      // bugs.rtfd 2026-06-13 V: unit-derived display tier/rate for the
      // volume family — covers EVERY month (closed windows included),
      // unlike the F2 in-progress entries which only exist for open-
      // window months with a non-zero delta. Both come from the same
      // writer helpers on the same unit series, so they always agree.
      const volumeDisplay = isVolumeWalkTerm
        ? volumeDisplayByTermMonth.get(sourceTerm.id)?.get(month)
        : undefined
      const walkAccrual = isVolumeWalkTerm
        ? (inProgressVolume?.accrued ?? 0)
        : row.accruedAmount
      totalAccrued += walkAccrual
      totalGrowthBaseline += Number(row.growthBaselineApplied ?? 0)
      if (walkAccrual > 0) {
        contributions.push({
          termIndex,
          accruedAmount: walkAccrual,
          // V: unit-derived tier/rate first; then the F2 in-progress
          // entry; non-volume terms keep the walk's values.
          tierAchieved:
            volumeDisplay?.tierAchieved ??
            inProgressVolume?.tierAchieved ??
            row.tierAchieved,
          rebatePercent:
            volumeDisplay?.rebatePercent ??
            inProgressVolume?.rebatePercent ??
            row.rebatePercent,
        })
      }
      // Pick the term with the highest tier as the row's headline
      // tier. For zero-accrual months (annual-eval pre-year-end), we
      // still want the term's CURRENT tier on the row so the user
      // sees their tracking progress. Tiebreak on rate when tiers
      // match, then on accrual size.
      //
      // bugs.rtfd 2026-06-13 V: volume-family candidates use the
      // unit-derived tier/rate — never the dollar walk's (which compared
      // dollars against unit thresholds).
      const candidateTier = volumeDisplay
        ? volumeDisplay.tierAchieved
        : row.tierAchieved
      const candidatePercent = volumeDisplay
        ? volumeDisplay.rebatePercent
        : row.rebatePercent
      const tierBeat = candidateTier > bestTier
      const sameTierBetterRate =
        candidateTier === bestTier && candidatePercent > bestPercent
      const sameTierBetterAccrual =
        candidateTier === bestTier &&
        candidatePercent === bestPercent &&
        row.accruedAmount > bestContribution
      if (tierBeat || sameTierBetterRate || sameTierBetterAccrual) {
        bestContribution = row.accruedAmount
        bestTier = candidateTier
        bestPercent = candidatePercent
        if (volumeDisplay) {
          // The achieved VOLUME tier's own type + raw value (e.g.
          // fixed_rebate_per_unit · 5 → "$5.00 / unit").
          bestRebateType = volumeDisplay.rebateType
          bestRebateValue = volumeDisplay.rebateValue
        } else {
          const sourceTier = sourceTerm.tiers.find(
            (t) => t.tierNumber === row.tierAchieved,
          )
          bestRebateType = sourceTier?.rebateType ?? null
          bestRebateValue = sourceTier ? Number(sourceTier.rebateValue) : 0
        }
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
      // bugs.rtfd 2026-06-13 M: stamped from the window shares below.
      marketSharePercent: null,
      // bugs.rtfd 2026-06-13: growth-baseline cut summed across this month's
      // contributing terms; the period-end month carries the window's full
      // cut, which the subtotal merge rolls up.
      growthBaselineApplied: totalGrowthBaseline,
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

  // 2026-06-09: overlay the persisted carve-out / threshold / volume accrual
  // into the MONTHLY rows (see hasOverlayTerm above). Each overlay Rebate row
  // lands in the month containing its payPeriodEnd; months with no
  // tier-engine row are appended so accrual outside the COG-spend window
  // still shows.
  //
  // 2026-06-10 (Charles "there are two terms one is market share the other
  // is spend rebate the timeline should reflect that"): overlay rows now
  // ATTRIBUTE to their term — the writer notes carry `term:<id>` and
  // `tier N`, so each row joins termContributions under its own label and
  // the multi-term breakdown shows BOTH terms instead of silently folding
  // the market-share dollars into an unlabeled total.
  const overlayTermLabels: Array<{
    termIndex: number
    termName: string
    evaluationPeriod: string
  }> = []
  // bugs.rtfd 2026-06-13 M: hoisted out of the `overlayRebateRows.length`
  // guard — the market-share visibility pass below must register the
  // term's label / month rows even when the writer persisted ZERO rows
  // (below-threshold windows), which was exactly the invisibility bug.
  const walkIndexByTermId = new Map(
    termsWithTiers.map((t, i) => [t.id, i] as const),
  )
  const overlayIndexByTermId = new Map<string, number>()
  const overlayIndexFor = (termId: string | null): number | null => {
    if (!termId) return null
    const walkIdx = walkIndexByTermId.get(termId)
    if (walkIdx !== undefined) return walkIdx
    const existingIdx = overlayIndexByTermId.get(termId)
    if (existingIdx !== undefined) return existingIdx
    const term = contract.terms.find((t) => t.id === termId)
    if (!term) return null
    const idx = termsWithTiers.length + overlayTermLabels.length
    overlayIndexByTermId.set(termId, idx)
    overlayTermLabels.push({
      termIndex: idx,
      termName: term.termName ?? "Rebate term",
      evaluationPeriod: term.evaluationPeriod ?? "annual",
    })
    return idx
  }
  const byKey = new Map(rows.map((r) => [r.month, r]))

  if (overlayRebateRows.length > 0) {
    for (const cr of overlayRebateRows) {
      if (!cr.payPeriodEnd) continue
      const monthKey = `${cr.payPeriodEnd.getUTCFullYear()}-${String(
        cr.payPeriodEnd.getUTCMonth() + 1,
      ).padStart(2, "0")}`
      const earned = Number(cr.rebateEarned ?? 0)
      const termId = cr.notes?.match(/term:(\S+)/)?.[1] ?? null
      const tierFromNotes = Number(cr.notes?.match(/tier (\d+)/)?.[1] ?? 0)
      // bugs.rtfd 2026-06-13 V: volume-writer notes carry NO `tier N` —
      // fall back to the unit-derived display tier for the term-month so
      // a closed window's overlay contribution shows its real tier.
      const tierAchieved =
        tierFromNotes > 0
          ? tierFromNotes
          : termId
            ? (volumeDisplayByTermMonth.get(termId)?.get(monthKey)
                ?.tierAchieved ?? 0)
            : 0
      const termIndex = overlayIndexFor(termId)
      // bugs.rtfd 2026-06-11 A2: the writer note carries only `tier N` —
      // resolve the achieved tier's RATE from the contributing term's
      // tiers (already loaded on contract.terms). Pre-fix this was
      // hardcoded 0, so a market-share term at "Tier 2 · 9.0%" showed its
      // dollar contribution with no rate in the per-term breakout.
      // Percent tiers scale fraction→percent inside the helper; dollar
      // tier types stay 0 (never render $ as %).
      const overlayTerm = termId
        ? contract.terms.find((t) => t.id === termId)
        : undefined
      const overlayRate = resolveOverlayTierRate(overlayTerm, tierAchieved)

      let target = byKey.get(monthKey)
      if (!target) {
        target = {
          month: monthKey,
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
          growthBaselineApplied: 0,
        }
        byKey.set(monthKey, target)
        rows.push(target)
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
            // A2: the higher tier wins the merge — carry its rate too.
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
    }
  }

  // bugs.rtfd 2026-06-13 M: market-share visibility on the normal path.
  // (1) Register the term's label + a $0 window-end contribution for any
  // evaluation window the writer persisted NO row for (below-threshold
  // → periodPayment 0 → skipped) so the term never silently vanishes;
  // (2) stamp every month with its window's share for the Market Share
  // column. Persisted overlay rows above stay authoritative — windows
  // they already cover are never double-annotated.
  if (marketShareDisplay) {
    for (const we of marketShareDisplay.windowEnds) {
      const termIndex = overlayIndexFor(we.termId)
      if (termIndex === null) continue
      let target = byKey.get(we.month)
      if (!target) {
        target = {
          month: we.month,
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
          growthBaselineApplied: 0,
        }
        byKey.set(we.month, target)
        rows.push(target)
      }
      const existing = target.termContributions.find(
        (c) => c.termIndex === termIndex,
      )
      if (existing) continue
      target.termContributions.push({
        termIndex,
        accruedAmount: 0,
        tierAchieved: we.tierAchieved,
        rebatePercent: we.rebatePercent,
      })
    }
    for (const r of rows) {
      r.marketSharePercent =
        marketShareDisplay.shareByMonth.get(r.month) ?? null
    }
  }

  // Keep chronological order (YYYY-MM sorts lexicographically).
  rows.sort((a, b) => (a.month < b.month ? -1 : 1))

  // 2026-06-10 (Charles "the monthly data was removed it is just showing
  // cumulative annuals"): the 2026-06-09 quarterly fix collapsed per-month
  // rows into evaluation-period buckets, which fixed the tier-math window
  // but deleted monthly visibility. Now: keep EVERY month row, and insert a
  // bold subtotal row at each evaluation-period boundary (quarter / half /
  // year) where the tier actually settles. Tier evaluation still runs at
  // the term cadence — only the display changed. Monthly-eval and
  // multi-term ("lifetime") contracts keep plain per-month rows.
  const displayRows: TimelineRowWithVolume[] =
    primaryEval === "monthly" || primaryEval === "lifetime"
      ? rows
      : (() => {
          const out: TimelineRowWithVolume[] = []
          let bucket: TimelineRowWithVolume | null = null
          const flush = () => {
            if (bucket) out.push(bucket)
            bucket = null
          }
          for (const r of rows) {
            const key = periodKeyFor(r.month)
            if (bucket && bucket.month !== key) flush()
            out.push(r)
            const cur: TimelineRowWithVolume | null = bucket
            if (!cur) {
              bucket = { ...r, month: key, isPeriodSubtotal: true }
              continue
            }
            const better: boolean =
              r.tierAchieved > cur.tierAchieved ||
              (r.tierAchieved === cur.tierAchieved &&
                r.rebatePercent > cur.rebatePercent)
            bucket = {
              ...cur,
              spend: cur.spend + r.spend,
              // period-end running total (cumulative already resets per period)
              cumulativeSpend: r.cumulativeSpend,
              accruedAmount: cur.accruedAmount + r.accruedAmount,
              // bugs.rtfd 2026-06-13: the subtotal's growth-baseline basis is
              // the sum of the window's monthly cuts (only the period-end
              // month is non-zero, but sum to be cadence-agnostic).
              growthBaselineApplied:
                cur.growthBaselineApplied + r.growthBaselineApplied,
              volume: cur.volume + r.volume,
              tierAchieved: better ? r.tierAchieved : cur.tierAchieved,
              rebatePercent: better ? r.rebatePercent : cur.rebatePercent,
              achievedRebateType: better
                ? r.achievedRebateType
                : cur.achievedRebateType,
              achievedRebateValue: better
                ? r.achievedRebateValue
                : cur.achievedRebateValue,
              // bugs.rtfd 2026-06-13 M: the subtotal carries the period's
              // settled share — the latest month with a value wins.
              marketSharePercent:
                r.marketSharePercent ?? cur.marketSharePercent,
              // Merge by termIndex — a year subtotal must show one line per
              // term, not one line per term-month (2026-06-10).
              termContributions: ((): MultiTermTimelineRow["termContributions"] => {
                const merged = new Map<
                  number,
                  MultiTermTimelineRow["termContributions"][number]
                >(cur.termContributions.map((c) => [c.termIndex, { ...c }]))
                for (const c of r.termContributions) {
                  const prev = merged.get(c.termIndex)
                  if (prev) {
                    prev.accruedAmount += c.accruedAmount
                    if (c.tierAchieved > prev.tierAchieved) {
                      prev.tierAchieved = c.tierAchieved
                      prev.rebatePercent = c.rebatePercent
                    }
                  } else {
                    merged.set(c.termIndex, { ...c })
                  }
                }
                return Array.from(merged.values())
              })(),
            }
          }
          flush()
          return out
        })()

  // Per-term labels so the Accrual Timeline UI can render each term's
  // contribution on multi-term contracts instead of collapsing to the
  // "best" term. Without this, a contract with a spend rebate + a
  // category-scoped rebate shows only the dominant rate, which led users
  // to report "it's only pulling from the 1st one" (2026-04-23).
  const termLabels = [
    ...termsWithTiers.map((t, i) => ({
      termIndex: i,
      termName: t.termName ?? `Term ${i + 1}`,
      evaluationPeriod: t.evaluationPeriod ?? "annual",
    })),
    // 2026-06-10: overlay terms (market-share / compliance / carve-out /
    // volume rows attributed above) get their own labels so the per-term
    // breakdown names them.
    ...overlayTermLabels,
  ]

  return serialize({
    rows: displayRows,
    method,
    termLabels,
    cumulativeReset,
    isVolumeRebate,
  })
}
