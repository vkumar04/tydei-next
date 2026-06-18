/**
 * Canonical CPT → payor-rate map builder for case-costing reimbursement
 * backfill.
 *
 * Why this exists (2026-06 case-costing audit H5): the same ~30-line
 * "build a CPT rate map from PayorContract.cptRates JSON" block was
 * copy-pasted into `getCases`, `getFacilityAveragesForFacility`, and
 * `calculatePayorMargins`, while `getCaseCostingReportData` used the raw
 * stored `Case.totalReimbursement` (0 in most prod states) — so the
 * report header's "Avg Margin" contradicted the per-case tables beside
 * it. This module is the ONE place the rate-map filter lives, mirroring
 * the canonical-reducer policy in CLAUDE.md.
 *
 * Pure functions — no Prisma imports. Callers pass the `cptRates` JSON
 * straight off the PayorContract rows.
 *
 * Shape tolerance: the seeded payor-contract JSON uses
 * `{cpt, rate, description}`, but a future migration to Prisma relations
 * may use `{cptCode, rate}`. Accept both so either seed format lights up
 * reimbursement.
 *
 * Time-bucketed rates (2026-06-17, Lighthouse Anthem): multi-year payor
 * contracts list one rate per CPT PER contract year (e.g. Anthem's
 * "Rates Effective 6/1/2023–5/31/2024" / "…6/1/2024–5/31/2025" / "…2025–26").
 * Each year's rate is stored as a separate `cptRates` row carrying its own
 * `effectiveDate` (the window start). `buildCptRateSchedule` groups them by
 * CPT and `resolveCaseReimbursement` picks the rate effective as of the
 * case's date of surgery — so a 2024 case no longer gets a 2023 (or, worse,
 * a 2025 highest-wins) rate. Rows WITHOUT an effectiveDate keep the legacy
 * "highest rate wins" behaviour, so seeded single-rate contracts are
 * unaffected.
 */

export interface PayorContractRatesRow {
  /** `PayorContract.cptRates` JSON column, passed through untouched. */
  cptRates: unknown
}

type RawCptRate = {
  cpt?: string
  cptCode?: string
  rate?: unknown
  effectiveDate?: unknown
  effectiveFrom?: unknown
}

/** One CPT rate that takes effect on `effectiveFrom` (null = undated). */
export interface RateBucket {
  rate: number
  effectiveFrom: Date | null
}

/** Best-effort parse of a stored effective-date value into a Date or null. */
function parseEffectiveFrom(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Fold one or more payor contracts' `cptRates` JSON into a
 * CPT → time-ordered rate buckets map. Each bucket is one (rate,
 * effectiveFrom) pair; buckets are sorted ascending by effectiveFrom with
 * undated rates first. This is the date-aware index `resolveCaseReimbursement`
 * resolves against.
 */
export function buildCptRateSchedule(
  payorContracts: PayorContractRatesRow[],
): Map<string, RateBucket[]> {
  const schedule = new Map<string, RateBucket[]>()
  for (const pc of payorContracts) {
    const rates = Array.isArray(pc.cptRates)
      ? (pc.cptRates as RawCptRate[])
      : []
    for (const r of rates) {
      const code = r.cptCode ?? r.cpt
      if (!code || typeof r.rate !== "number") continue
      const effectiveFrom = parseEffectiveFrom(r.effectiveDate ?? r.effectiveFrom)
      const buckets = schedule.get(code) ?? []
      buckets.push({ rate: r.rate, effectiveFrom })
      schedule.set(code, buckets)
    }
  }
  for (const buckets of schedule.values()) {
    buckets.sort((a, b) => {
      if (a.effectiveFrom && b.effectiveFrom) {
        return a.effectiveFrom.getTime() - b.effectiveFrom.getTime()
      }
      if (!a.effectiveFrom && !b.effectiveFrom) return 0
      return a.effectiveFrom ? 1 : -1 // undated first
    })
  }
  return schedule
}

/**
 * The rate effective as of `asOf` for one CPT's buckets:
 *  - no buckets carry a date → legacy "highest rate wins"
 *  - `asOf` given → latest bucket whose effectiveFrom ≤ asOf (or the
 *    earliest dated bucket when asOf precedes every window)
 *  - dated buckets but no `asOf` → the earliest (conservative) rate
 */
export function rateAsOf(
  buckets: RateBucket[] | undefined,
  asOf: Date | null,
): number | undefined {
  if (!buckets || buckets.length === 0) return undefined
  const dated = buckets.filter((b) => b.effectiveFrom)
  if (dated.length === 0) {
    return Math.max(...buckets.map((b) => b.rate))
  }
  if (asOf) {
    let chosen: RateBucket | undefined
    for (const b of dated) {
      if (b.effectiveFrom! <= asOf) chosen = b
      else break
    }
    return (chosen ?? dated[0]).rate
  }
  return dated[0].rate
}

/**
 * Fold payor contracts into a flat CPT → best-rate map (HIGHEST rate wins
 * across years/contracts/duplicates). Date-insensitive; for display call
 * sites (e.g. the payor-contract rate preview) that have no single case
 * date. Per-case reimbursement should use `buildCptRateSchedule` +
 * `resolveCaseReimbursement` instead.
 */
export function buildCptRateMap(
  payorContracts: PayorContractRatesRow[],
): Map<string, number> {
  const schedule = buildCptRateSchedule(payorContracts)
  const flat = new Map<string, number>()
  for (const [code, buckets] of schedule) {
    flat.set(code, Math.max(...buckets.map((b) => b.rate)))
  }
  return flat
}

export interface CaseForReimbursement {
  /** Stored `Case.totalReimbursement` (already Number()-coerced). */
  storedReimbursement: number
  primaryCptCode: string | null
  /** CPT codes from the case's procedure rows (may be empty). */
  procedureCptCodes: Array<string | null>
}

/**
 * Effective reimbursement for a case: the stored value when it's
 * explicitly set (> 0), otherwise the best CPT-rate estimate across
 * (a) the primary CPT and (b) any procedure CPT — some cases import
 * with procedure rows but no primary flag set. Each CPT contributes the
 * rate effective as of `caseDate` (the case's date of surgery); the best
 * matching CPT wins.
 */
export function resolveCaseReimbursement(
  c: CaseForReimbursement,
  schedule: Map<string, RateBucket[]>,
  caseDate: Date | null,
): number {
  if (c.storedReimbursement > 0) return c.storedReimbursement
  let computed = 0
  if (c.primaryCptCode) {
    computed = rateAsOf(schedule.get(c.primaryCptCode), caseDate) ?? 0
  }
  for (const code of c.procedureCptCodes) {
    if (!code) continue
    const rate = rateAsOf(schedule.get(code), caseDate)
    if (rate !== undefined && rate > computed) computed = rate
  }
  return computed
}
