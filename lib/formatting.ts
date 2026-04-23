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

export function formatDate(date: string | Date | null | undefined): string {
  if (date === null || date === undefined) return "—"
  const d = new Date(date)
  // Evergreen sentinel. `lib/actions/contracts.ts` writes 9999-12-31 when
  // a contract has no fixed expiration (AI extractor returned null).
  if (d.getUTCFullYear() >= 9999) return "Evergreen"
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    // Contract dates are stored as UTC midnight (e.g. 2024-01-01T00:00:00Z).
    // Formatting without an explicit timeZone defaults to the runtime's
    // local zone, which shifts UTC-midnight dates to the previous calendar
    // day for viewers west of UTC. Pin to UTC so the displayed date always
    // matches the stored calendar date.
    timeZone: "UTC",
  }).format(d)
}

export function formatDateRange(
  start: string | Date,
  end: string | Date
): string {
  return `${formatDate(start)} – ${formatDate(end)}`
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
