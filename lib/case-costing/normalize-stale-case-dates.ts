/**
 * Demo-data date normalization for case imports.
 *
 * Why (Vick 2026-06-15): the canonical demo case export is dated Dec 2023.
 * Imported in 2026 it lands entirely outside every trailing-12-month
 * surface (case-costing reports, dashboard, surgeon/financial tabs default
 * to the last 12 months), so the reports render empty — and a manual DB
 * date-shift reverts on the next Delete-All + re-import. Normalizing at
 * IMPORT time makes it durable: every upload of stale data surfaces.
 *
 * Conservative by design — only fires when the WHOLE upload is stale (the
 * newest case is older than ~12 months). A genuinely recent upload (or any
 * upload whose newest case is within the trailing year) is returned as
 * `null` and left untouched, so real current data is never silently moved.
 *
 * When it fires, cases are spread evenly across the trailing 12 months
 * ending `now`, preserving their original relative order — so a single
 * tight Dec-2023 cluster becomes a smooth 12-month series the trend charts
 * can render. Pure + deterministic (caller passes `now`).
 */

const DAY_MS = 86_400_000
const WINDOW_DAYS = 364

export interface DatedCaseInput {
  caseNumber: string
  dateOfSurgery: Date
}

/**
 * Returns a `caseNumber → new Date` map when the upload is entirely stale,
 * or `null` when it should be left as-is. Cases with an unparseable date
 * are ignored for the staleness decision and omitted from the map (the
 * caller keeps their original value).
 */
export function computeStaleDateShift(
  cases: DatedCaseInput[],
  now: Date,
): Map<string, Date> | null {
  const valid = cases.filter((c) => !Number.isNaN(c.dateOfSurgery.getTime()))
  if (valid.length === 0) return null

  const nowMidnightMs = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  )
  const maxMs = Math.max(...valid.map((c) => c.dateOfSurgery.getTime()))

  // Newest case still within the trailing year → not stale, don't touch.
  if (maxMs >= nowMidnightMs - WINDOW_DAYS * DAY_MS) return null

  // Spread across [today-364d, today], ordered by original date then
  // caseNumber so the result is stable across re-imports.
  const sorted = [...valid].sort(
    (a, b) =>
      a.dateOfSurgery.getTime() - b.dateOfSurgery.getTime() ||
      a.caseNumber.localeCompare(b.caseNumber),
  )
  const startMs = nowMidnightMs - WINDOW_DAYS * DAY_MS
  const n = sorted.length
  const map = new Map<string, Date>()
  sorted.forEach((c, i) => {
    const dayOffset =
      n > 1 ? Math.round((i * WINDOW_DAYS) / (n - 1)) : WINDOW_DAYS
    map.set(c.caseNumber, new Date(startMs + dayOffset * DAY_MS))
  })
  return map
}
