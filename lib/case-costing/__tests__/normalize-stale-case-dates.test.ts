/**
 * computeStaleDateShift — import-time demo-date normalization.
 *
 * 2026-06-15: the Dec-2023 demo case export imported in 2026 landed outside
 * every trailing-12-month report window, and a manual DB shift reverted on
 * re-import. These tests pin the import-time normalization: stale uploads
 * spread across the recent window, recent uploads untouched.
 */
import { describe, it, expect } from "vitest"
import { computeStaleDateShift } from "@/lib/case-costing/normalize-stale-case-dates"

const NOW = new Date(Date.UTC(2026, 5, 15)) // 2026-06-15
const d = (s: string) => new Date(s)
const DAY = 86_400_000

describe("computeStaleDateShift", () => {
  it("returns null for a recent upload (newest case within the trailing year)", () => {
    const cases = [
      { caseNumber: "A", dateOfSurgery: d("2026-05-01") },
      { caseNumber: "B", dateOfSurgery: d("2024-01-01") }, // old, but max is recent
    ]
    expect(computeStaleDateShift(cases, NOW)).toBeNull()
  })

  it("returns null for empty / all-invalid input", () => {
    expect(computeStaleDateShift([], NOW)).toBeNull()
    expect(
      computeStaleDateShift(
        [{ caseNumber: "X", dateOfSurgery: new Date("not-a-date") }],
        NOW,
      ),
    ).toBeNull()
  })

  it("shifts a fully-stale upload into the trailing 12 months", () => {
    // 674-ish Dec-2023 cluster, all > 12 months old
    const cases = Array.from({ length: 100 }, (_, i) => ({
      caseNumber: `C${i}`,
      dateOfSurgery: d(`2023-12-${String((i % 28) + 1).padStart(2, "0")}`),
    }))
    const map = computeStaleDateShift(cases, NOW)
    expect(map).not.toBeNull()
    expect(map!.size).toBe(100)
    const dates = [...map!.values()].map((v) => v.getTime()).sort((a, b) => a - b)
    const todayMs = Date.UTC(2026, 5, 15)
    // newest lands on today, oldest ~364 days before, all inside the window
    expect(dates[dates.length - 1]).toBe(todayMs)
    expect(dates[0]).toBe(todayMs - 364 * DAY)
    for (const ms of dates) {
      expect(ms).toBeGreaterThanOrEqual(todayMs - 364 * DAY)
      expect(ms).toBeLessThanOrEqual(todayMs)
    }
  })

  it("is deterministic (stable across re-imports of the same data)", () => {
    const cases = [
      { caseNumber: "B", dateOfSurgery: d("2023-12-10") },
      { caseNumber: "A", dateOfSurgery: d("2023-12-10") },
      { caseNumber: "C", dateOfSurgery: d("2023-12-01") },
    ]
    const a = computeStaleDateShift(cases, NOW)!
    const b = computeStaleDateShift(cases, NOW)!
    expect([...a.entries()]).toEqual([...b.entries()])
    // earliest original date (C) maps to the start of the window
    expect(a.get("C")!.getTime()).toBe(Date.UTC(2026, 5, 15) - 364 * DAY)
  })
})
