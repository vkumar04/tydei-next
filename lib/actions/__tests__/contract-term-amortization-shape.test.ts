/**
 * Wave D — amortization-shape persistence (Charles W1.T contract-level move).
 *
 * Capital/amortization concerns moved off ContractTerm onto Contract. The
 * engine's `buildScheduleForTerm` helper still returns the same shape, so
 * we keep the pure-function preview tests below. The persistence tests
 * that used to live here (writing ContractAmortizationSchedule rows from
 * the term-save path) are now owned by lib/actions/__tests__/
 * contract-capital-update.test.ts against `updateContract`.
 */
import { describe, it, expect } from "vitest"
import { buildScheduleForTerm } from "@/lib/contracts/tie-in-schedule"

describe("Wave D — inline symmetrical preview", () => {
  it("produces a non-empty schedule when capital / interest / term are set", () => {
    const schedule = buildScheduleForTerm({
      capitalCost: 120_000,
      downPayment: 20_000,
      interestRate: 0.06,
      termMonths: 12,
      paymentCadence: "monthly",
    })
    expect(schedule).toHaveLength(12)
    // Opening balance on period 1 = capitalCost - downPayment.
    expect(schedule[0]!.openingBalance).toBe(100_000)
    // Final closing balance ≈ 0 (PMT clears the principal).
    expect(Math.abs(schedule[11]!.closingBalance)).toBeLessThan(0.01)
  })

  it("returns [] when required inputs are missing so the form shows empty state", () => {
    expect(
      buildScheduleForTerm({
        capitalCost: null,
        interestRate: 0.05,
        termMonths: 12,
        paymentCadence: "monthly",
      }),
    ).toEqual([])
    expect(
      buildScheduleForTerm({
        capitalCost: 100_000,
        interestRate: 0.05,
        termMonths: null,
        paymentCadence: "monthly",
      }),
    ).toEqual([])
  })
})

describe("Wave D — toggle flip seed (pure-function preview)", () => {
  it("symmetrical → custom: seeds from the engine when no custom rows yet", () => {
    // Pre-flip, the form's symmetricalSchedule memo is what the custom
    // table displays on its first render — asserting it matches the
    // engine output locks in the "preserve computed numbers as seed"
    // contract.
    const seed = buildScheduleForTerm({
      capitalCost: 60_000,
      interestRate: 0,
      termMonths: 6,
      paymentCadence: "monthly",
    })
    expect(seed).toHaveLength(6)
    // Equal $10k payments for zero-interest.
    for (const row of seed) {
      expect(row.amortizationDue).toBeCloseTo(10_000, 2)
    }
  })
})
