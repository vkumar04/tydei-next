/**
 * Case costing — date-range preset resolver.
 *
 * Reference: docs/superpowers/specs/2026-04-18-case-costing-rewrite.md
 * Canonical facility-case-costing §7 (date range filter, shared with
 * reports-hub-rewrite.md).
 *
 * All computations are in UTC. Returned ranges are inclusive on both
 * ends: `from` is the first instant of the start day (00:00:00.000Z),
 * `to` is the last instant of the end day (23:59:59.999Z).
 *
 * Pure — no DB, no side effects.
 */

export type DateRangePreset =
  | "today"
  | "yesterday"
  | "this_week"
  | "last_week"
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "last_quarter"
  | "ytd"
  | "last_12_months"

export interface DateRange {
  from: Date
  to: Date
}

/**
 * Resolve a preset token to an inclusive UTC date range anchored to `now`
 * (defaults to `new Date()`).
 *
 * Weeks: ISO-style, Monday as first day of week.
 * Quarters: Q1=Jan–Mar, Q2=Apr–Jun, Q3=Jul–Sep, Q4=Oct–Dec.
 * YTD: Jan 1 of the current year → `now`'s day (end-of-day).
 * last_12_months: 11 months before `now`'s month, same day if possible,
 *   but normalized to the start of that day → end of `now`'s day.
 */
export function resolveDateRange(
  preset: DateRangePreset,
  now: Date = new Date(),
): DateRange {
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() // 0–11
  const day = now.getUTCDate()

  switch (preset) {
    case "today": {
      return { from: startOfDay(year, month, day), to: endOfDay(year, month, day) }
    }
    case "yesterday": {
      const y = addDaysUTC(year, month, day, -1)
      return {
        from: startOfDay(y.year, y.month, y.day),
        to: endOfDay(y.year, y.month, y.day),
      }
    }
    case "this_week": {
      const weekStart = startOfIsoWeek(year, month, day)
      const weekEnd = addDaysUTC(weekStart.year, weekStart.month, weekStart.day, 6)
      return {
        from: startOfDay(weekStart.year, weekStart.month, weekStart.day),
        to: endOfDay(weekEnd.year, weekEnd.month, weekEnd.day),
      }
    }
    case "last_week": {
      const thisWeekStart = startOfIsoWeek(year, month, day)
      const lastWeekStart = addDaysUTC(
        thisWeekStart.year,
        thisWeekStart.month,
        thisWeekStart.day,
        -7,
      )
      const lastWeekEnd = addDaysUTC(
        lastWeekStart.year,
        lastWeekStart.month,
        lastWeekStart.day,
        6,
      )
      return {
        from: startOfDay(lastWeekStart.year, lastWeekStart.month, lastWeekStart.day),
        to: endOfDay(lastWeekEnd.year, lastWeekEnd.month, lastWeekEnd.day),
      }
    }
    case "this_month": {
      const lastDay = daysInMonthUTC(year, month)
      return {
        from: startOfDay(year, month, 1),
        to: endOfDay(year, month, lastDay),
      }
    }
    case "last_month": {
      const lastMonth = month === 0 ? 11 : month - 1
      const lastMonthYear = month === 0 ? year - 1 : year
      const lastDay = daysInMonthUTC(lastMonthYear, lastMonth)
      return {
        from: startOfDay(lastMonthYear, lastMonth, 1),
        to: endOfDay(lastMonthYear, lastMonth, lastDay),
      }
    }
    case "this_quarter": {
      const qStartMonth = Math.floor(month / 3) * 3
      const qEndMonth = qStartMonth + 2
      const lastDay = daysInMonthUTC(year, qEndMonth)
      return {
        from: startOfDay(year, qStartMonth, 1),
        to: endOfDay(year, qEndMonth, lastDay),
      }
    }
    case "last_quarter": {
      const qStartMonth = Math.floor(month / 3) * 3
      let lastQStartMonth = qStartMonth - 3
      let lastQYear = year
      if (lastQStartMonth < 0) {
        lastQStartMonth += 12
        lastQYear -= 1
      }
      const lastQEndMonth = lastQStartMonth + 2
      const lastDay = daysInMonthUTC(lastQYear, lastQEndMonth)
      return {
        from: startOfDay(lastQYear, lastQStartMonth, 1),
        to: endOfDay(lastQYear, lastQEndMonth, lastDay),
      }
    }
    case "ytd": {
      return {
        from: startOfDay(year, 0, 1),
        to: endOfDay(year, month, day),
      }
    }
    case "last_12_months": {
      // 12-month window ending today (inclusive). Start 11 months before
      // the current month, on the 1st of that month? No — canonical intent
      // is "the last 12 months": from (now - 12 months + 1 day) to now.
      // Implementation: subtract 12 months, add 1 day.
      const start = addDaysUTC(
        ...shiftMonths(year, month, day, -12),
        1,
      )
      return {
        from: startOfDay(start.year, start.month, start.day),
        to: endOfDay(year, month, day),
      }
    }
  }
}

// ─── Internal date helpers (UTC) ───────────────────────────────────

function startOfDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0))
}

function endOfDay(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 23, 59, 59, 999))
}

function daysInMonthUTC(year: number, month: number): number {
  // month is 0–11. Day 0 of next month = last day of current month.
  return new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
}

interface Ymd {
  year: number
  month: number
  day: number
}

function addDaysUTC(
  year: number,
  month: number,
  day: number,
  delta: number,
): Ymd {
  const d = new Date(Date.UTC(year, month, day))
  d.setUTCDate(d.getUTCDate() + delta)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth(),
    day: d.getUTCDate(),
  }
}

/**
 * Shift a (year, month, day) by `deltaMonths` months, clamping the day to
 * the last valid day of the resulting month.
 * Returns a tuple for convenient spreading.
 */
function shiftMonths(
  year: number,
  month: number,
  day: number,
  deltaMonths: number,
): [number, number, number] {
  const totalMonths = year * 12 + month + deltaMonths
  const newYear = Math.floor(totalMonths / 12)
  const newMonth = ((totalMonths % 12) + 12) % 12
  const maxDay = daysInMonthUTC(newYear, newMonth)
  const newDay = Math.min(day, maxDay)
  return [newYear, newMonth, newDay]
}

/**
 * ISO week starts Monday. Day-of-week: UTC getUTCDay() → 0=Sun, 1=Mon … 6=Sat.
 * Mapping to Monday-based offset: (dow + 6) % 7.
 */
function startOfIsoWeek(year: number, month: number, day: number): Ymd {
  const d = new Date(Date.UTC(year, month, day))
  const dow = d.getUTCDay()
  const offset = (dow + 6) % 7
  return addDaysUTC(year, month, day, -offset)
}
