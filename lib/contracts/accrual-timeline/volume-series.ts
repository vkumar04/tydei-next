/**
 * Volume series + display state for the accrual timeline. Moved verbatim
 * from `lib/actions/contracts/accrual.ts` (2026-08-05 decomposition):
 * the per-month unit/spend series (Bug 3), the F2 display-only
 * in-progress accrual for the current unclosed window, and the V
 * unit-derived display tier/rate maps.
 */
import { prisma } from "@/lib/db"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import { resolveOverlayTierRate } from "@/lib/contracts/tier-rebate-label"
// bug-bash 2026-06-11 follow-up F2: the volume writer's tier math +
// window bucketing, exported as pure helpers so the timeline's
// display-only in-progress accrual is writer-consistent by construction
// (the writer calls the same functions — canonical-helper culture).
import {
  computeVolumeTierRebate,
  currentOpenVolumeWindow,
  normalizeVolumeTiers,
  selectAchievedVolumeTier,
} from "@/lib/contracts/recompute/volume"
import type {
  AccrualContract,
  InProgressVolumeByTermMonth,
  OverlayRebateRow,
  VolumeDisplayByTermMonth,
} from "./types"

export async function buildVolumeSeriesState(ctx: {
  contract: AccrualContract
  facilityId: string
  end: Date
  isVolumeRebate: boolean
  termsWithTiers: AccrualContract["terms"]
  cogCategoryUniverse: string[]
  overlayRebateRows: OverlayRebateRow[]
}): Promise<{
  volumeByMonth: Map<string, number>
  volumeUnitsByTermMonth: Map<string, Map<string, number>>
  volumeSpendByTermMonth: Map<string, Map<string, number>>
  inProgressVolumeByTermMonth: InProgressVolumeByTermMonth
  volumeDisplayByTermMonth: VolumeDisplayByTermMonth
}> {
  const {
    contract,
    facilityId,
    end,
    isVolumeRebate,
    termsWithTiers,
    cogCategoryUniverse,
    overlayRebateRows,
  } = ctx

  // Bug 3 (2026-05-17): build a per-month volume series for the UI.
  // Mirrors the volume-rebate writer (`lib/contracts/recompute/volume.ts`):
  //   - CPT mode (term has cptCodes): count distinct case+CPT
  //     occurrences from Case.procedures within the month.
  //   - COG-fallback (no cptCodes): sum COGRecord.quantity within the
  //     month, scoped to the term's category filter.
  // We sum across every volume_rebate term so a month's "Volume" reads
  // as the total qty that drove ANY volume tier this month.
  const volumeByMonth = new Map<string, number>()
  // bug-bash 2026-06-11 follow-up F2: per-term per-month unit + in-scope
  // spend maps, captured while the volume series is built. They feed the
  // display-only in-progress accrual for the current UNCLOSED evaluation
  // window below (the writer only persists rows for CLOSED windows).
  const volumeUnitsByTermMonth = new Map<string, Map<string, number>>()
  const volumeSpendByTermMonth = new Map<string, Map<string, number>>()
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
        const termUnits = new Map<string, number>()
        for (const [m, set] of seenPerMonth) {
          volumeByMonth.set(m, (volumeByMonth.get(m) ?? 0) + set.size)
          termUnits.set(m, set.size)
        }
        // F2: CPT counts feed the in-progress display too (the helper
        // works on counts regardless of source). No per-month COG spend
        // basis here, so percent_of_spend tiers display $0 mid-window —
        // status quo, no regression; the writer's CPT path sources its
        // spend separately at window close.
        volumeUnitsByTermMonth.set(term.id, termUnits)
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
          // bug-bash 2026-06-11 follow-up F1, same drift class as the
          // 2026-06-09 audit fix above: group-aware vendor set — bare
          // contract.vendorId under-counted the displayed "Volume (units)"
          // on grouped contracts whose spend sits under member vendors,
          // while the group-aware writer counted the full vendor basis.
          vendorId: { in: contractVendorIds(contract) },
          transactionDate: { gte: contract.effectiveDate, lte: end },
          ...unionWhereForVolume,
        },
        select: {
          transactionDate: true,
          quantity: true,
          // F2: per-month in-scope spend basis so percent_of_spend volume
          // tiers can show in-progress display accrual mid-window.
          extendedPrice: true,
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
        const termUnits = new Map<string, number>()
        const termSpend = new Map<string, number>()
        for (const r of cogVolRows) {
          const d = r.transactionDate
          if (!d) continue
          if (term.effectiveStart && d < term.effectiveStart) continue
          if (term.effectiveEnd && d > term.effectiveEnd) continue
          if (categorySet && !categorySet.has(r.category ?? "")) continue
          const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
          volumeByMonth.set(key, (volumeByMonth.get(key) ?? 0) + (r.quantity ?? 0))
          termUnits.set(key, (termUnits.get(key) ?? 0) + (r.quantity ?? 0))
          termSpend.set(
            key,
            (termSpend.get(key) ?? 0) +
              (r.extendedPrice == null ? 0 : Number(r.extendedPrice)),
          )
        }
        volumeUnitsByTermMonth.set(term.id, termUnits)
        volumeSpendByTermMonth.set(term.id, termSpend)
      }
    }
  }

  // bug-bash 2026-06-11 follow-up F2 (Charles screenshot — bug A5
  // residual): an annual volume term showed per-month units (802, 485…)
  // and a real "$11.00 / unit" rate in the timeline but Accrued $0 for
  // every month until the first evaluation window CLOSED, because the
  // writer (`lib/contracts/recompute/volume.ts`) only persists
  // `[auto-volume-accrual]` rows for closed windows (W1.W-B1 honesty
  // rule — ledger earned stays `payPeriodEnd <= today`; the writer's
  // gating is intentionally untouched) and the walk zeroes volume-term
  // accrual in favor of that overlay. Spend terms, meanwhile, show LIVE
  // walk accrual every month on the SAME timeline — the inconsistency is
  // the bug. Close the gap with a DISPLAY-ONLY in-progress accrual for
  // months inside the current UNCLOSED window, computed by the writer's
  // own exported helper (`computeVolumeTierRebate` on window-cumulative
  // units — never a reimplementation). Each month is attributed the
  // DELTA of the window-to-date value, so when a tier boundary is
  // crossed mid-window the cumulative-method recompute-on-window-total
  // behavior is preserved and the month series sums to exactly what the
  // writer WILL persist at window close. Scope: timeline display only —
  // this file writes no Rebate rows; Earned cards / ledger are untouched.
  const inProgressVolumeByTermMonth = new Map<
    string,
    Map<
      string,
      { accrued: number; tierAchieved: number; rebatePercent: number }
    >
  >()
  if (isVolumeRebate) {
    for (const term of termsWithTiers) {
      if (term.termType !== "volume_rebate") continue
      // PO-basis terms count PurchaseOrders, not COG units — the unit
      // series captured above would be the wrong basis for them.
      if (term.volumeType === "purchase_order") continue
      const termUnits = volumeUnitsByTermMonth.get(term.id)
      if (!termUnits) continue
      const window = currentOpenVolumeWindow({
        contractEffectiveDate: contract.effectiveDate,
        contractExpirationDate: contract.expirationDate,
        effectiveStart: term.effectiveStart,
        effectiveEnd: term.effectiveEnd,
        evaluationPeriod: term.evaluationPeriod,
      })
      if (!window) continue
      // No-double-count guard: by construction the unclosed window holds
      // no persisted overlay rows, but ASSERT it — any month at or before
      // the latest persisted `[auto-volume-accrual]` payPeriodEnd for
      // this term is already covered by the overlay and must not also
      // receive in-progress display accrual.
      const termOverlayPrefix = `[auto-volume-accrual] term:${term.id}`
      let latestOverlayEnd: Date | null = null
      for (const cr of overlayRebateRows) {
        if (!cr.payPeriodEnd) continue
        if (!cr.notes?.startsWith(termOverlayPrefix)) continue
        if (!latestOverlayEnd || cr.payPeriodEnd > latestOverlayEnd) {
          latestOverlayEnd = cr.payPeriodEnd
        }
      }
      const latestOverlayMonth = latestOverlayEnd
        ? `${latestOverlayEnd.getUTCFullYear()}-${String(
            latestOverlayEnd.getUTCMonth() + 1,
          ).padStart(2, "0")}`
        : null

      const sortedTiers = normalizeVolumeTiers(term.tiers)
      const termSpend = volumeSpendByTermMonth.get(term.id)
      const out = new Map<
        string,
        { accrued: number; tierAchieved: number; rebatePercent: number }
      >()
      let cumulativeUnits = 0
      let cumulativeSpend = 0
      let prevWindowToDate = 0
      // Walk the open window's months up to the timeline horizon (`end`
      // = min(today, expiry)) — never past the window's natural close.
      const horizon = new Date(
        Math.min(end.getTime(), window.windowEnd.getTime()),
      )
      const cursor = new Date(
        Date.UTC(
          window.windowStart.getUTCFullYear(),
          window.windowStart.getUTCMonth(),
          1,
        ),
      )
      const lastMonth = new Date(
        Date.UTC(horizon.getUTCFullYear(), horizon.getUTCMonth(), 1),
      )
      while (cursor <= lastMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        cumulativeUnits += termUnits.get(key) ?? 0
        cumulativeSpend += termSpend?.get(key) ?? 0
        const { achieved, rebateEarned } = computeVolumeTierRebate(
          sortedTiers,
          cumulativeUnits,
          cumulativeSpend,
        )
        const delta = rebateEarned - prevWindowToDate
        prevWindowToDate = rebateEarned
        const coveredByOverlay =
          latestOverlayMonth !== null && key <= latestOverlayMonth
        if (!coveredByOverlay && delta !== 0) {
          out.set(key, {
            accrued: delta,
            tierAchieved: achieved?.tierNumber ?? 0,
            // Same A2 helper the overlay path uses: percent tiers scale
            // fraction→percent; dollar tiers stay 0 (never render $ as %).
            rebatePercent: resolveOverlayTierRate(
              term,
              achieved?.tierNumber ?? 0,
            ),
          })
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      if (out.size > 0) inProgressVolumeByTermMonth.set(term.id, out)
    }
  }

  // bugs.rtfd 2026-06-13 V (prod cmqbcw4wd00040ypgudy9modb): the volume
  // family's displayed Tier / Rate came from the DOLLAR tier walk, whose
  // cumulative SPEND was compared against the term's UNIT thresholds
  // (stored in spendMin/spendMax) — the recurring dollars-vs-units
  // type-confusion class. $2.4M spend ≥ "5001" showed "Tier 2 ·
  // $7.00/unit" on rows whose ACCRUAL was correctly $5/unit (3,873
  // window units) — the display contradicted the math on the same row.
  //
  // Fix: derive the displayed tier/rate for EVERY month from
  // window-cumulative UNITS via the writer's own exported
  // `selectAchievedVolumeTier` (the same helper the accrual math and the
  // persisting writer use — no parallel ladder logic). Window bucketing
  // reuses `currentOpenVolumeWindow` as a pure month→window probe
  // (`today` = a timestamp inside the month) so the grid anchoring is
  // writer-identical for closed AND open windows. Closed windows get the
  // same rule — e.g. a 2024 window ending at 7,755 units displays tier 2
  // / "$7.00 / unit", matching its persisted 7,755 × $7 overlay row.
  const volumeDisplayByTermMonth = new Map<
    string,
    Map<
      string,
      {
        tierAchieved: number
        rebatePercent: number
        rebateType: string | null
        rebateValue: number
      }
    >
  >()
  if (isVolumeRebate) {
    for (const term of termsWithTiers) {
      if (term.termType !== "volume_rebate") continue
      // PO-basis terms count PurchaseOrders, not COG units — the unit
      // series captured above would be the wrong basis for them.
      if (term.volumeType === "purchase_order") continue
      const termUnits = volumeUnitsByTermMonth.get(term.id)
      if (!termUnits) continue
      const sortedTiers = normalizeVolumeTiers(term.tiers)
      const termStartMs = Math.max(
        contract.effectiveDate.getTime(),
        term.effectiveStart?.getTime() ?? -Infinity,
      )
      const horizonMs = Math.min(
        end.getTime(),
        term.effectiveEnd?.getTime() ?? Infinity,
      )
      if (horizonMs < termStartMs) continue
      const out = new Map<
        string,
        {
          tierAchieved: number
          rebatePercent: number
          rebateType: string | null
          rebateValue: number
        }
      >()
      const termStart = new Date(termStartMs)
      const horizon = new Date(horizonMs)
      const cursor = new Date(
        Date.UTC(termStart.getUTCFullYear(), termStart.getUTCMonth(), 1),
      )
      const lastMonth = new Date(
        Date.UTC(horizon.getUTCFullYear(), horizon.getUTCMonth(), 1),
      )
      let windowStartMs: number | null = null
      let windowUnits = 0
      while (cursor <= lastMonth) {
        const key = `${cursor.getUTCFullYear()}-${String(
          cursor.getUTCMonth() + 1,
        ).padStart(2, "0")}`
        // Probe: any timestamp inside this month past the term clamp —
        // the writer-grid window containing it is exactly the first
        // window still open as of that instant.
        const probe = new Date(Math.max(cursor.getTime(), termStartMs) + 1)
        const window = currentOpenVolumeWindow({
          contractEffectiveDate: contract.effectiveDate,
          contractExpirationDate: contract.expirationDate,
          effectiveStart: term.effectiveStart,
          effectiveEnd: term.effectiveEnd,
          evaluationPeriod: term.evaluationPeriod,
          today: probe,
        })
        if (window) {
          if (windowStartMs !== window.windowStart.getTime()) {
            // New evaluation window — cumulative units reset.
            windowStartMs = window.windowStart.getTime()
            windowUnits = 0
          }
          windowUnits += termUnits.get(key) ?? 0
          const achieved = selectAchievedVolumeTier(sortedTiers, windowUnits)
          out.set(key, {
            tierAchieved: achieved?.tierNumber ?? 0,
            // A2 rule via the canonical helper: percent tiers scale
            // fraction→percent; dollar tiers stay 0 (never render $ as %).
            rebatePercent: resolveOverlayTierRate(
              term,
              achieved?.tierNumber ?? 0,
            ),
            rebateType: achieved?.rebateType ?? null,
            rebateValue: achieved?.rebateValue ?? 0,
          })
        }
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
      if (out.size > 0) volumeDisplayByTermMonth.set(term.id, out)
    }
  }

  return {
    volumeByMonth,
    volumeUnitsByTermMonth,
    volumeSpendByTermMonth,
    inProgressVolumeByTermMonth,
    volumeDisplayByTermMonth,
  }
}
