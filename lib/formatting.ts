import { EVERGREEN_MS } from "@/lib/contracts/evergreen"

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
})

const currencyFormatterPrecise = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

export function formatCurrency(value: number, precise = false): string {
  return precise
    ? currencyFormatterPrecise.format(value)
    : currencyFormatter.format(value)
}

/**
 * Format a calendar date (@db.Date column — effective/expiration,
 * period start/end, pay-period end, etc.) pinned to UTC so the
 * displayed day matches the stored day regardless of viewer tz.
 *
 * Use for: `Contract.effectiveDate`, `Contract.expirationDate`,
 * `ContractTerm.effectiveStart/End`, `ContractPeriod.periodStart/End`,
 * `Rebate.payPeriodStart/End`. Anything stored as a @db.Date.
 */
export function formatCalendarDate(
  date: string | Date | null | undefined,
): string {
  if (date === null || date === undefined || date === "") return "—"
  const d = new Date(date)
  if (isNaN(d.getTime())) return "—"
  // Exact-millis sentinel check, not year >= 9999, so unrelated far-
  // future dates don't false-positive as Evergreen.
  if (d.getTime() === EVERGREEN_MS) return "Evergreen"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

/**
 * Format a timestamp (real wall-clock instant — createdAt, submittedAt,
 * collectionDate, lastSentAt, etc.) in the viewer's local timezone.
 *
 * Previously this helper was UTC-pinned to fix an off-by-one on @db.Date
 * columns, but that also shifted real timestamps (a 2pm-PST event on
 * April 22 displayed as "Apr 23"). Split out `formatCalendarDate` for
 * the UTC case; `formatDate` stays local-tz to match wall-clock reality.
 */
export function formatDate(
  date: string | Date | null | undefined,
): string {
  if (date === null || date === undefined || date === "") return "—"
  const d = new Date(date)
  if (isNaN(d.getTime())) return "—"
  if (d.getTime() === EVERGREEN_MS) return "Evergreen"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d)
}

/** Calendar-date range (uses `formatCalendarDate` for both endpoints). */
export function formatDateRange(
  start: string | Date,
  end: string | Date,
): string {
  return `${formatCalendarDate(start)} – ${formatCalendarDate(end)}`
}

export function formatPercent(value: number, decimals = 1): string {
  return `${value.toFixed(decimals)}%`
}

export function formatCompactNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value)
}
