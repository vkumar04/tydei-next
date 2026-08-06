/**
 * Cadence math + per-item amortization aggregation for the tie-in capital
 * schedule reads.
 *
 * Extracted verbatim from `lib/actions/contracts/tie-in.ts` during the
 * large-file decomposition. The server actions stay in that file
 * (action-id stability); this module is the pure computation layer.
 * `buildTieInAmortizationSchedule` (lib/rebates/engine/amortization.ts)
 * is wired into the actions through `aggregatePerItemSchedules` here —
 * see the engine-wiring manifest (lib/actions/__tests__/
 * engine-wiring-manifest.test.ts).
 *
 * Framework-free (no Prisma client, no server-action imports) so Vitest
 * can exercise it directly.
 */
import { buildTieInAmortizationSchedule } from "@/lib/rebates/engine/amortization"
import type { AmortizationEntry } from "@/lib/rebates/engine/types"
import type { NormalizedCapitalLineItem } from "@/lib/contracts/capital-line-items"
import type { CollectedRebateLike } from "@/lib/contracts/rebate-collected-filter"

export type Cadence = "monthly" | "quarterly" | "semi_annual" | "annual"

const CADENCES: readonly string[] = ["monthly", "quarterly", "semi_annual", "annual"]
/** Coerce a contract's rebatePayPeriod (PerformancePeriod enum) to a Cadence. */
export function toCadence(s: string | null | undefined): Cadence | undefined {
  return s && CADENCES.includes(s) ? (s as Cadence) : undefined
}

export function monthsPerPeriod(p: "monthly" | "quarterly" | "semi_annual" | "annual"): number {
  switch (p) {
    case "monthly":
      return 1
    case "quarterly":
      return 3
    case "semi_annual":
      return 6
    case "annual":
      return 12
  }
}

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date)
  d.setMonth(d.getMonth() + months)
  return d
}

/**
 * Charles audit suggestion #4 (v0-port): aggregate per-item
 * amortization schedules into a combined view. Each line item
 * amortizes independently (its own financedPrincipal × interestRate
 * × termMonths × cadence) and the rows are summed period-by-period.
 *
 * Items with different cadences are first projected onto the longest
 * cadence's grid (e.g. quarterly + monthly → monthly grid; quarterly
 * payments land on every 3rd month). Items with different term
 * lengths produce zero rows past their own end (the longest term
 * defines schedule length).
 */
export function aggregatePerItemSchedules(
  items: ReadonlyArray<NormalizedCapitalLineItem>,
  // Bug 3: when set, every item amortizes on this cadence instead of its
  // own stored paymentCadence — used to make the schedule follow the
  // contract's rebatePayPeriod.
  cadenceOverride?: Cadence,
): { entries: AmortizationEntry[]; period: Cadence } {
  if (items.length === 0) return { entries: [], period: "monthly" }
  // Bug #11 defense-in-depth: if every item has zero financed principal
  // (e.g. user set Initial Sales == Contract Total), there's nothing to
  // amortize — return empty so the UI surfaces the "no schedule" empty
  // state instead of N rows full of $0 columns. The parent
  // `getContractCapitalSchedule` already short-circuits via
  // `financedPrincipal <= 0` but this guards aggregator-callers too.
  const totalFinanced = items.reduce(
    (acc, i) => acc + Math.max(0, i.contractTotal - i.initialSales),
    0,
  )
  if (totalFinanced <= 0) return { entries: [], period: "monthly" }

  // Find the finest cadence (smallest months-per-period) so we render
  // on the densest possible grid — unless the caller overrides it.
  const cadences = new Set(items.map((i) => i.paymentCadence))
  const period: Cadence =
    cadenceOverride ??
    (cadences.has("monthly")
      ? "monthly"
      : cadences.has("quarterly")
        ? "quarterly"
        : cadences.has("semi_annual")
          ? "semi_annual"
          : "annual")
  const stepMonths = monthsPerPeriod(period)

  // Build each item's schedule on its own cadence, then map onto the
  // combined cadence's period numbers.
  const totalMonths = Math.max(...items.map((i) => i.termMonths))
  const totalPeriods = Math.ceil(totalMonths / stepMonths)
  const combined = Array.from({ length: totalPeriods }, (_, i) => ({
    periodNumber: i + 1,
    openingBalance: 0,
    interestCharge: 0,
    principalDue: 0,
    amortizationDue: 0,
    closingBalance: 0,
  }))

  for (const item of items) {
    const itemFinanced = Math.max(0, item.contractTotal - item.initialSales)
    if (itemFinanced <= 0 || item.termMonths <= 0) continue
    const itemCadence = cadenceOverride ?? item.paymentCadence
    const sched = buildTieInAmortizationSchedule({
      capitalCost: itemFinanced,
      interestRate: item.interestRate,
      termMonths: item.termMonths,
      period: itemCadence,
    })
    const itemStep = monthsPerPeriod(itemCadence)
    // Charles audit final: project the per-item schedule onto the
    // combined grid, carrying balances forward in non-payment periods
    // so the running-balance display stays smooth instead of
    // sawtoothing on quarterly-on-monthly grids. The item's payment
    // (interest + principal + amortizationDue) only lands in the
    // period its payment is actually due; openingBalance and
    // closingBalance carry the item's outstanding principal across
    // every period.
    let lastClosing = itemFinanced
    let scheduleIdx = 0
    for (let p = 0; p < combined.length; p++) {
      const monthsAtEndOfPeriod = (p + 1) * stepMonths
      // Walk the per-item schedule rows whose due-date falls within
      // this combined period.
      const target = combined[p]
      target.openingBalance += lastClosing
      while (
        scheduleIdx < sched.length &&
        sched[scheduleIdx].periodNumber * itemStep <= monthsAtEndOfPeriod
      ) {
        const row = sched[scheduleIdx]
        target.interestCharge += row.interestCharge
        target.principalDue += row.principalDue
        target.amortizationDue += row.amortizationDue
        lastClosing = row.closingBalance
        scheduleIdx += 1
      }
      target.closingBalance += lastClosing
    }
  }

  return { entries: combined, period }
}

/**
 * Charles 2026-04-25 (Bug 23): bucket collected rebates into amortization
 * periods so the schedule can show how much rebate paid down capital each
 * period. Extracted verbatim from the loop that was duplicated across the
 * facility and vendor schedule reads in `lib/actions/contracts/tie-in.ts`.
 *
 * Callers gate on `isTieIn || isCapital` before invoking (non-capital
 * contract types get an empty map). Rebates collected before the schedule
 * start are skipped; collections are clamped into [1, entryCount].
 */
export function bucketCollectionsByPeriod(
  rebates: ReadonlyArray<CollectedRebateLike>,
  start: Date,
  entryCount: number,
  monthsStep: number,
): Map<number, number> {
  const collectionsByPeriod = new Map<number, number>()
  for (const r of rebates) {
    if (!r.collectionDate) continue
    const collectedMs = new Date(r.collectionDate).getTime()
    const startMs = start.getTime()
    if (collectedMs < startMs) continue
    const monthsSinceStart =
      (collectedMs - startMs) / (1000 * 60 * 60 * 24 * 30.4375)
    const periodNumber = Math.max(
      1,
      Math.min(entryCount, Math.ceil(monthsSinceStart / monthsStep)),
    )
    const prior = collectionsByPeriod.get(periodNumber) ?? 0
    collectionsByPeriod.set(
      periodNumber,
      prior + Number(r.rebateCollected ?? 0),
    )
  }
  return collectionsByPeriod
}
