/**
 * Charles W1.Y-C cross-surface parity test — tie-in capital-applied.
 *
 * Reproduces the disagreement Charles flagged on 2026-04-20:
 *
 *   - Capital Amortization card "Paid to Date": $293,465 (forecast)
 *   - Header sublabel "applied to capital":     $185,124 (min(earned, schedule))
 *   - Rebates Collected (lifetime):             $195,124 (sumCollectedRebates)
 *
 * Under Charles's rule (100% of collected rebate retires capital on
 * tie-in), all three surfaces MUST agree on $195,124 — the sum of
 * collected rebate. The canonical helper that owns this invariant is
 * `sumRebateAppliedToCapital` in `lib/contracts/rebate-capital-filter.ts`.
 *
 * This file is the tripwire — if any surface drifts off the helper in
 * the future, this test fails.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { sumRebateAppliedToCapital } from "@/lib/contracts/rebate-capital-filter"

// ─── Deterministic fixture ──────────────────────────────────────

const FIXTURE_CONTRACT_ID = "c-tiein-parity"
const FIXTURE_CAPITAL = 500_000

type RebateRow = {
  id: string
  rebateEarned: number
  rebateCollected: number
  payPeriodEnd: Date | null
  collectionDate: Date | null
}

// Matches Charles's 11:42 AM screenshot numbers:
//   3 collected rows summing to $195,124
//   1 earned-but-uncollected row of $19,280 (YTD figure)
const FIXTURE_REBATES: RebateRow[] = [
  {
    id: "r-1-collected",
    rebateEarned: 50_000,
    rebateCollected: 50_000,
    payPeriodEnd: new Date("2025-03-31"),
    collectionDate: new Date("2025-04-15"),
  },
  {
    id: "r-2-collected",
    rebateEarned: 75_000,
    rebateCollected: 75_000,
    payPeriodEnd: new Date("2025-06-30"),
    collectionDate: new Date("2025-07-20"),
  },
  {
    id: "r-3-collected",
    rebateEarned: 70_124,
    rebateCollected: 70_124,
    payPeriodEnd: new Date("2025-09-30"),
    collectionDate: new Date("2025-10-15"),
  },
  {
    id: "r-4-uncollected",
    rebateEarned: 19_280,
    rebateCollected: 0,
    payPeriodEnd: new Date("2026-03-31"),
    collectionDate: null,
  },
]

const EXPECTED_APPLIED_TO_CAPITAL = 195_124

// ─── Mocks for the server-action surface ───────────────────────

let contractRow: {
  id: string
  contractType: string
  effectiveDate: Date
  capitalCost: number
  interestRate: number
  termMonths: number
  paymentCadence: string
  amortizationShape: string
  amortizationRows: Array<unknown>
  rebates: Array<{
    collectionDate: Date | null
    rebateCollected: number
  }>
} | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirst: vi.fn(async () => contractRow),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/actions/contracts-auth", () => ({
  contractOwnershipWhere: vi.fn((id: string, _fid: string) => ({ id })),
  contractsOwnedByFacility: vi.fn(() => ({})),
  facilityScopeClause: vi.fn(() => ({})),
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(x: T) => x,
}))

beforeEach(() => {
  vi.clearAllMocks()
  contractRow = null
})

describe("tie-in capital-applied parity (W1.Y-C)", () => {
  it("tie-in capital-applied reconciles across surfaces (Charles iMessage 2026-04-20)", async () => {
    // Canonical helper — the single source of truth.
    const appliedFromHelper = sumRebateAppliedToCapital(
      FIXTURE_REBATES,
      "tie_in",
    )
    expect(appliedFromHelper).toBe(EXPECTED_APPLIED_TO_CAPITAL)

    // Surface 1 — `getContractCapitalSchedule` server action. This feeds
    // both the Capital Amortization card's "Paid to Date" tile AND the
    // contract-detail header "applied to capital" sublabel (via
    // TieInRebateSplit), so if this returns the canonical number both
    // surfaces are reconciled.
    contractRow = {
      id: FIXTURE_CONTRACT_ID,
      contractType: "tie_in",
      effectiveDate: new Date("2024-01-01"),
      capitalCost: FIXTURE_CAPITAL,
      interestRate: 0.05,
      termMonths: 60,
      paymentCadence: "quarterly",
      amortizationShape: "symmetric",
      amortizationRows: [],
      rebates: FIXTURE_REBATES.map((r) => ({
        collectionDate: r.collectionDate,
        rebateCollected: r.rebateCollected,
      })),
    }

    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const result = await getContractCapitalSchedule(FIXTURE_CONTRACT_ID)

    // All three surfaces must agree.
    expect(result.rebateAppliedToCapital).toBe(EXPECTED_APPLIED_TO_CAPITAL)
    expect(result.paidToDate).toBe(EXPECTED_APPLIED_TO_CAPITAL)
    expect(result.paidToDate).toBe(appliedFromHelper)

    // Remaining balance is capitalCost − paidToDate (clamped ≥ 0).
    expect(result.remainingBalance).toBe(
      FIXTURE_CAPITAL - EXPECTED_APPLIED_TO_CAPITAL,
    )
  })

  it("non-tie_in contracts: rebateAppliedToCapital and paidToDate are 0", async () => {
    contractRow = {
      id: FIXTURE_CONTRACT_ID,
      contractType: "capital",
      effectiveDate: new Date("2024-01-01"),
      capitalCost: FIXTURE_CAPITAL,
      interestRate: 0.05,
      termMonths: 60,
      paymentCadence: "quarterly",
      amortizationShape: "symmetric",
      amortizationRows: [],
      rebates: FIXTURE_REBATES.map((r) => ({
        collectionDate: r.collectionDate,
        rebateCollected: r.rebateCollected,
      })),
    }

    const { getContractCapitalSchedule } = await import(
      "@/lib/actions/contracts/tie-in"
    )
    const result = await getContractCapitalSchedule(FIXTURE_CONTRACT_ID)

    expect(result.rebateAppliedToCapital).toBe(0)
    expect(result.paidToDate).toBe(0)
  })
})
