import { describe, it, expect } from "vitest"
import { parsePayorVolumeRows } from "../parse-payor-volume-rows"

/**
 * Regression: the quarter fallback used an UNANCHORED `/q?\s*([1-4])/i`. The
 * engine retried at every start position and `\s*` rescanned the whitespace
 * run from each — quadratic. A 200KB cell of spaces blocked the event loop
 * for ~17s, and the payor-volume route accepts a 20MB file.
 */
describe("payor volume quarter parsing — ReDoS regression", () => {
  it("a huge whitespace quarter cell parses in constant time", () => {
    const rows = [
      {
        "Procedure Group": "Total Knee Replacement",
        Year: "2025",
        Quarter: " ".repeat(200_000),
        Volume: "100",
      },
    ]
    const t0 = performance.now()
    const result = parsePayorVolumeRows(rows)
    const elapsed = performance.now() - t0
    // Pre-fix this took ~17,000ms. Generous ceiling so the test is not flaky
    // on a loaded machine while still failing hard on a quadratic regression.
    expect(elapsed).toBeLessThan(250)
    // Unparseable quarter → the row is skipped, not guessed at.
    expect(result.groups).toHaveLength(0)
  })

  it("still reads the real quarter shapes", () => {
    const mk = (q: string) => ({
      "Procedure Group": "G",
      Year: "2025",
      Quarter: q,
      Volume: "10",
    })
    for (const q of ["2", "Q2", "q2", " Q2 ", "Q 2"]) {
      const { groups } = parsePayorVolumeRows([mk(q)])
      expect(groups[0]?.quarters[0]?.quarter, `quarter input ${q}`).toBe(2)
    }
  })

  it("rejects out-of-range and junk quarter values", () => {
    const mk = (q: string) => ({
      "Procedure Group": "G",
      Year: "2025",
      Quarter: q,
      Volume: "10",
    })
    for (const q of ["0", "5", "Q9", "not a quarter", ""]) {
      expect(parsePayorVolumeRows([mk(q)]).groups, `quarter input ${q}`)
        .toHaveLength(0)
    }
  })
})
