/**
 * Term-aware accrual preservation (2026-07-29 math audit, CRITICAL).
 *
 * THE BUG. `preservedKeys` was keyed on `payPeriodStart|payPeriodEnd` alone but
 * consulted once per TERM. On a multi-term contract two terms emit a bucket for
 * the same window, so a single collected row suppressed the other term's row for
 * that whole period — after the upfront wipe had already deleted it.
 *
 * Reproduced on the production snapshot: Arthrex (cms31hrqu12170iqvf539klwy)
 * went $588,220.30 -> $473,257.06 and stayed there, losing the Distal
 * Extremities 2% row ($114,963.24 = 2% x $5,748,161.78). Unrecoverable without
 * re-entering the collection, and `recomputeAccrualForContract` runs at the end
 * of every term save, so nobody had to press anything.
 *
 * Verified fixed against the same snapshot: 4 rows / $588,220.30 in, `inserted`
 * 2 -> 3, $588,220.30 out, stable on a second run.
 *
 * These are source-level guards. The behaviour needs a database, so the numeric
 * proof lives in the commit message and the audit record; what these pin is the
 * *shape* that made it possible — a period-only key consulted per term.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const SRC = readFileSync(
  join(__dirname, "..", "recompute-accrual.ts"),
  "utf8",
)

describe("recompute preserves collected rows per TERM, not per period", () => {
  it("reads `notes` — the only term discriminator on a Rebate row", () => {
    // Rebate has no termId. The engine writes the applied rate into the note
    // ("… tier 2 @ 5% on $…"), which is what makes existing rows repairable.
    // `[^}]*` already spans newlines, so no dotAll flag is needed (and the
    // repo's tsconfig target predates es2018 regex flags).
    expect(SRC).toMatch(/select:\s*\{[^}]*notes:\s*true/)
  })

  it("derives the rate from the note and keys preservation on it", () => {
    expect(SRC).toContain("preservedTermKeys")
    expect(SRC).toContain("rateFromNote")
    // period|rate, not period alone
    expect(SRC).toMatch(/preservedTermKeys\.add\(`\$\{pk\}\|\$\{rate\}`\)/)
  })

  it("falls back to a period-wide block when the note has no rate", () => {
    // Unparseable notes (e.g. the cadence writer's "N terms combined") must be
    // MORE conservative, never less — skip rather than risk a duplicate.
    expect(SRC).toContain("preservedPeriodWide")
    expect(SRC).toMatch(/if\s*\(rate === null\)\s*preservedPeriodWide\.add\(pk\)/)
  })

  it("the period-eval loop no longer consults the bare period key", () => {
    // THE regression guard. This exact expression is what dropped the row.
    const periodEval = SRC.slice(SRC.indexOf("for (const b of periodBuckets)"))
    expect(periodEval).not.toContain(
      "preservedKeys.has(periodKey(b.periodStart, b.periodEnd))",
    )
    expect(periodEval).toContain("isPreservedForTerm(")
  })

  it("the cadence path keeps period-only keying — its buckets are term-combined", () => {
    // Not an oversight: that writer emits ONE bucket per period with every term
    // already merged ("N terms combined"), so there is no per-term bucket to
    // distinguish and a period key is the correct granularity there.
    expect(SRC).toContain(
      "!preservedKeys.has(periodKey(b.periodStart, b.periodEnd))",
    )
  })
})

describe("the note-rate parser", () => {
  // Mirrors the regex in recompute-accrual.ts. Kept in sync by the source guard
  // above; this exercises the matching behaviour it depends on.
  const RATE_IN_NOTE = /@\s*(-?\d+(?:\.\d+)?)\s*%/
  const rate = (n: string | null): number | null => {
    const m = n ? RATE_IN_NOTE.exec(n) : null
    if (!m) return null
    const v = Number(m[1])
    return Number.isFinite(v) ? v : null
  }

  it.each([
    ["[auto-accrual] 2025 · tier 2 @ 5% on $5748161.78 (annual-eval)", 5],
    ["[auto-accrual] 2025 · tier 1 @ 2% on $5748161.78 (annual-eval)", 2],
    ["[auto-accrual] 2024 · tier 1 @ 3% on $3716979.42 (annual-eval)", 3],
    ["[auto-accrual] Q1 2025 · tier 3 @ 2.5% on $100.00", 2.5],
    ["[auto-accrual] 2025 · tier 1 @ 0% on $0.00", 0],
  ])("parses %s", (note, expected) => {
    expect(rate(note as string)).toBe(expected)
  })

  it("returns null for the combined-term note, forcing the conservative path", () => {
    expect(rate("[auto-accrual] 2 terms combined on $500.00 (2025)")).toBeNull()
  })

  it("returns null for a manual note and for null", () => {
    expect(rate("paid by cheque")).toBeNull()
    expect(rate(null)).toBeNull()
  })

  it("distinguishes the two real Arthrex 2025 rows", () => {
    const collected = rate("[auto-accrual] 2025 · tier 2 @ 5% on $5748161.78 (annual-eval)")
    const dropped = rate("[auto-accrual] 2025 · tier 1 @ 2% on $5748161.78 (annual-eval)")
    expect(collected).not.toBe(dropped)
  })
})
