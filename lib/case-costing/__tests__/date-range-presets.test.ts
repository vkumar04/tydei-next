import { describe, it, expect } from "vitest"
import { resolveDateRange } from "../date-range-presets"

// Anchor: Wednesday, April 15, 2026 (UTC 10:30). Wed = getUTCDay() 3.
const NOW = new Date(Date.UTC(2026, 3, 15, 10, 30, 0))

function iso(d: Date): string {
  return d.toISOString()
}

describe("resolveDateRange", () => {
  it("today: start and end of current UTC day", () => {
    const r = resolveDateRange("today", NOW)
    expect(iso(r.from)).toBe("2026-04-15T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-15T23:59:59.999Z")
  })

  it("yesterday: start and end of previous UTC day", () => {
    const r = resolveDateRange("yesterday", NOW)
    expect(iso(r.from)).toBe("2026-04-14T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-14T23:59:59.999Z")
  })

  it("this_week: Monday → Sunday (ISO week)", () => {
    // 2026-04-15 is Wednesday → week is Mon 2026-04-13 to Sun 2026-04-19
    const r = resolveDateRange("this_week", NOW)
    expect(iso(r.from)).toBe("2026-04-13T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-19T23:59:59.999Z")
  })

  it("last_week: previous Mon–Sun", () => {
    const r = resolveDateRange("last_week", NOW)
    expect(iso(r.from)).toBe("2026-04-06T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-12T23:59:59.999Z")
  })

  it("this_week when anchor is Sunday (day-of-week edge)", () => {
    // 2026-04-12 is Sunday; Mon of that week is 2026-04-06
    const sun = new Date(Date.UTC(2026, 3, 12, 10, 0, 0))
    const r = resolveDateRange("this_week", sun)
    expect(iso(r.from)).toBe("2026-04-06T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-12T23:59:59.999Z")
  })

  it("this_month: first → last day of current UTC month", () => {
    const r = resolveDateRange("this_month", NOW)
    expect(iso(r.from)).toBe("2026-04-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-30T23:59:59.999Z")
  })

  it("last_month: handles January → previous December year rollover", () => {
    const jan = new Date(Date.UTC(2026, 0, 15, 0, 0, 0))
    const r = resolveDateRange("last_month", jan)
    expect(iso(r.from)).toBe("2025-12-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2025-12-31T23:59:59.999Z")
  })

  it("last_month: Feb in a leap year shows 29 days", () => {
    // 2024 is a leap year → Feb has 29 days.
    const mar2024 = new Date(Date.UTC(2024, 2, 10, 0, 0, 0))
    const r = resolveDateRange("last_month", mar2024)
    expect(iso(r.from)).toBe("2024-02-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2024-02-29T23:59:59.999Z")
  })

  it("this_quarter: Q2 (Apr–Jun)", () => {
    const r = resolveDateRange("this_quarter", NOW)
    expect(iso(r.from)).toBe("2026-04-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-06-30T23:59:59.999Z")
  })

  it("last_quarter: Q1 (Jan–Mar) when now is in Q2", () => {
    const r = resolveDateRange("last_quarter", NOW)
    expect(iso(r.from)).toBe("2026-01-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-03-31T23:59:59.999Z")
  })

  it("last_quarter: Q4 of previous year when now is in Q1", () => {
    const feb = new Date(Date.UTC(2026, 1, 10, 0, 0, 0))
    const r = resolveDateRange("last_quarter", feb)
    expect(iso(r.from)).toBe("2025-10-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2025-12-31T23:59:59.999Z")
  })

  it("ytd: Jan 1 of current year → end of today", () => {
    const r = resolveDateRange("ytd", NOW)
    expect(iso(r.from)).toBe("2026-01-01T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-15T23:59:59.999Z")
  })

  it("last_12_months: 12-month window ending today", () => {
    // 2026-04-15 minus 12 months = 2025-04-15, + 1 day = 2025-04-16
    const r = resolveDateRange("last_12_months", NOW)
    expect(iso(r.from)).toBe("2025-04-16T00:00:00.000Z")
    expect(iso(r.to)).toBe("2026-04-15T23:59:59.999Z")
  })

  it("defaults now to current time when omitted", () => {
    const r = resolveDateRange("today")
    // just check the result is a valid inclusive day range
    expect(r.to.getTime() - r.from.getTime()).toBe(
      24 * 60 * 60 * 1000 - 1,
    )
  })

  it("all preset tokens resolve (no throw)", () => {
    const presets = [
      "today",
      "yesterday",
      "this_week",
      "last_week",
      "this_month",
      "last_month",
      "this_quarter",
      "last_quarter",
      "ytd",
      "last_12_months",
    ] as const
    for (const p of presets) {
      const r = resolveDateRange(p, NOW)
      expect(r.from.getTime()).toBeLessThanOrEqual(r.to.getTime())
    }
  })
})
