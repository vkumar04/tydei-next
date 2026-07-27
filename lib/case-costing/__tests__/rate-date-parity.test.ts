import { describe, it, expect } from "vitest"
import {
  buildCptRateSchedule,
  resolveCaseReimbursement,
} from "../cpt-rate-map"
import {
  lookupReimbursement,
  type PayorCptRate,
} from "../reimbursement-lookup"
// The REAL normalization payor-margin.ts uses. Importing it is the whole
// point: the first version of this file reimplemented the mapping, so
// deleting `effectiveFrom` from the shipped code left all 200 tests in
// lib/case-costing + lib/actions/case-costing green. A parity test that
// rebuilds its own input cannot catch an input bug.
import { normalizePayorCptRates } from "../payor-rate-normalize"

/**
 * Why this exists (2026-07-26 prod audit):
 *
 * Two reducers resolve a CPT to a payor rate. `resolveCaseReimbursement`
 * (cpt-rate-map.ts) backs True Margin, the cases list, surgeons, facility
 * analysis and vendor prospective. `lookupReimbursement`
 * (reimbursement-lookup.ts) backs exactly one surface: the payor-margin
 * summary.
 *
 * cpt-rate-map learned to pick the rate effective as of the case date in
 * 2026-06-17, for multi-year contracts that list one rate per CPT per
 * contract year. The second implementation never did — and worse, the
 * caller's normalization dropped `effectiveDate` on the floor, so the
 * date-aware code that DID exist in reimbursement-lookup
 * (`inEffectiveWindow`, `pickMostRecent`) was fed nothing but nulls and
 * silently degraded to "first row in the JSON wins".
 *
 * That is precisely the failure mode CLAUDE.md's canonical-reducer rule
 * exists to prevent: one copy gets fixed, the other quietly keeps the old
 * behaviour, and the two disagree in production. Production carries 252 of
 * 336 rate rows with a date, so this was live.
 *
 * These tests pin the two together on the axis that drifted. They are
 * deliberately about DATE SELECTION only — the reducers legitimately differ
 * elsewhere (payor-margin ignores stored reimbursement because it models
 * "what would this payor pay", and only reads the primary CPT).
 */

const CPT = "22552"

/** A three-year contract: one rate per contract year, as Anthem stores it. */
const MULTI_YEAR = [
  { cpt: CPT, rate: 1000, effectiveDate: "2023-06-01" },
  { cpt: CPT, rate: 2000, effectiveDate: "2024-06-01" },
  { cpt: CPT, rate: 3000, effectiveDate: "2025-06-01" },
]

/**
 * The SHIPPED normalization, not a copy of it. If payor-margin.ts stops
 * carrying effectiveFrom, these tests fail.
 */
function normalizeLikePayorMargin(rows: typeof MULTI_YEAR): PayorCptRate[] {
  return normalizePayorCptRates(rows, "commercial")
}

function viaCanonical(asOf: Date) {
  return resolveCaseReimbursement(
    { storedReimbursement: 0, primaryCptCode: CPT, procedureCptCodes: [] },
    buildCptRateSchedule([{ cptRates: MULTI_YEAR }]),
    asOf,
  )
}

function viaPayorMargin(asOf: Date) {
  return lookupReimbursement(
    { primaryCptCode: CPT, payorType: "commercial", dateOfSurgery: asOf },
    normalizeLikePayorMargin(MULTI_YEAR),
  )
}

describe("payor rate date selection — the two reducers must agree", () => {
  it.each([
    ["a 2023 case", "2023-09-15", 1000],
    ["a 2024 case", "2024-09-15", 2000],
    ["a 2025 case", "2025-09-15", 3000],
  ])("%s resolves to its own contract year", (_label, iso, expected) => {
    const asOf = new Date(iso)
    expect(viaCanonical(asOf)).toBe(expected)
    expect(viaPayorMargin(asOf).reimbursement).toBe(expected)
  })

  it("does not report a guess as an exact match", () => {
    // The original bug's tell: the wrong year's rate, labelled "exact".
    const r = viaPayorMargin(new Date("2024-09-15"))
    expect(r.source).toBe("exact")
    expect(r.reimbursement).toBe(2000)
  })

  it("a boundary date takes the window it opens", () => {
    const asOf = new Date("2024-06-01")
    expect(viaCanonical(asOf)).toBe(2000)
    expect(viaPayorMargin(asOf).reimbursement).toBe(2000)
  })

  it("regression: dropping effectiveFrom collapses to first-row-wins", () => {
    // Reproduces the shipped bug — the normalization WITHOUT effectiveFrom.
    // Kept so the failure mode stays legible if anyone trims the mapping
    // again: every rate matches, and the sort key is uniformly 0.
    const undated: PayorCptRate[] = MULTI_YEAR.map((r) => ({
      payorType: "commercial",
      cptCode: r.cpt,
      reimbursement: r.rate,
    }))
    const wrong = lookupReimbursement(
      { primaryCptCode: CPT, payorType: "commercial", dateOfSurgery: new Date("2024-09-15") },
      undated,
    )
    expect(wrong.reimbursement).toBe(1000)
    expect(wrong.reimbursement).not.toBe(viaCanonical(new Date("2024-09-15")))
  })
})
