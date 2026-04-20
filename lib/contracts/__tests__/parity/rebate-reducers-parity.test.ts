/**
 * CROSS-SURFACE parity tests for rebate reducers (W1.U retro Fix 3).
 *
 * ─── Why this file exists ───────────────────────────────────────
 *
 * The W1.U retro (`docs/superpowers/retros/2026-04-19-w1u-retrospective.md`)
 * found that our 1831 passing tests verified each reducer in isolation, but
 * NOTHING asserted cross-surface numeric agreement. Two reducers on the same
 * invariant silently drifted:
 *
 *   - W1.R: contract detail header "Collected" card showed $90,000 while the
 *     Transactions tab showed $203,702 — two separate reducers, one invariant.
 *   - W1.U-B: header "Earned (YTD)" card showed $1,121 while the Transactions
 *     tab "Total Rebates (Lifetime)" showed thousands more — two separate
 *     reducers with subtly different temporal filters.
 *
 * Fix: one helper owns each invariant (see CLAUDE.md "Canonical reducers"
 * table). This file is the TRIPWIRE — it exercises each invariant's helper
 * against a single deterministic fixture and asserts numeric agreement
 * across every surface that renders the number.
 *
 * ─── Template contract ─────────────────────────────────────────
 *
 * THIS FILE IS THE TEST for any future reducer on these invariants.
 *
 *   - When you add a NEW surface that renders "Rebates Collected" or
 *     "Rebates Earned" (lifetime or YTD), add a line to the corresponding
 *     `describe("cross-surface agreement")` block that exercises the new
 *     surface against the shared FIXTURE and asserts the value matches the
 *     canonical helper's output. Do NOT add a new parity test file.
 *
 *   - When you add a NEW invariant (e.g. "Rebates Accrued (quarter-to-date)")
 *     that has more than one surface, add a new `describe` block here with
 *     its own FIXTURE section + cross-surface assertions. Register the
 *     invariant in CLAUDE.md's "Canonical reducers" table.
 *
 *   - When you change a canonical helper's semantics (e.g. switch `earned`
 *     from `payPeriodEnd <= today` to an `earnedDate` column), update the
 *     FIXTURE here first and watch every surface fall in line.
 *
 * The fixture MUST include boundary rows (future-dated, collected-but-not-
 * earned, prior-year, current-year) so the tripwire catches cases where a
 * reducer silently drifts on a subtle filter. `today` is pinned to
 * 2026-04-19 (the retro date) so this file does not depend on the calendar.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import {
  sumEarnedRebatesLifetime,
  sumEarnedRebatesYTD,
  type EarnedRebateLike,
} from "@/lib/contracts/rebate-earned-filter"
import {
  sumCollectedRebates,
  type CollectedRebateLike,
} from "@/lib/contracts/rebate-collected-filter"
import {
  sumDisplayedCollected,
  type PeriodRow,
} from "@/lib/contracts/transactions-display"

// ─── Deterministic fixture ──────────────────────────────────────
//
// Pinned at 2026-04-19 so this file is time-stable. The rows cover
// every branch the canonical reducers care about:
//
//   1. prior-year closed row (counts toward lifetime+collected, NOT YTD)
//   2. current-year closed row (counts everywhere earned)
//   3. current-year FUTURE row (doesn't count as earned anywhere but DOES
//      appear in collected if it has a collectionDate — the "collected
//      before earned" edge case enforced by the invariant)
//   4. null-payPeriodEnd row (skipped in earned aggregates)
//   5. uncollected row (counts as earned, NOT as collected)
//   6. prior-year collected row whose earned=0 (counts as collected only —
//      covers hand-entered adjustments where accrual happened long ago)

const TODAY = new Date("2026-04-19T12:00:00Z")
const FIXTURE_CONTRACT_ID = "c-parity"

type Row = {
  id: string
  rebateEarned: number
  rebateCollected: number
  payPeriodEnd: Date | null
  collectionDate: Date | null
}

const FIXTURE: Row[] = [
  // Row 1: prior-year closed, both earned and collected.
  {
    id: "r-prior-year-closed",
    rebateEarned: 500,
    rebateCollected: 400,
    payPeriodEnd: new Date("2025-06-30"),
    collectionDate: new Date("2025-07-15"),
  },
  // Row 2: current-year closed, earned only.
  {
    id: "r-ytd-closed",
    rebateEarned: 300,
    rebateCollected: 0,
    payPeriodEnd: new Date("2026-02-15"),
    collectionDate: null,
  },
  // Row 3: FUTURE pay-period but collectionDate set (edge case —
  // "collected-before-earned" adjustment). The invariant says collected
  // ignores payPeriodEnd; earned strictly filters future rows out.
  {
    id: "r-future-but-collected",
    rebateEarned: 999,
    rebateCollected: 100,
    payPeriodEnd: new Date("2026-09-30"),
    collectionDate: new Date("2026-03-01"),
  },
  // Row 4: null payPeriodEnd. Skipped by earned aggregates.
  {
    id: "r-null-period",
    rebateEarned: 50,
    rebateCollected: 0,
    payPeriodEnd: null,
    collectionDate: null,
  },
  // Row 5: current-year closed, earned but not yet collected.
  {
    id: "r-ytd-uncollected",
    rebateEarned: 200,
    rebateCollected: 0,
    payPeriodEnd: new Date("2026-03-31"),
    collectionDate: null,
  },
  // Row 6: prior-year collected-only (hand-entered adjustment).
  {
    id: "r-adjustment",
    rebateEarned: 0,
    rebateCollected: 75,
    payPeriodEnd: new Date("2024-12-31"),
    collectionDate: new Date("2026-01-05"),
  },
]

// ─── Expected values (hand-computed from FIXTURE) ──────────────
//
//   Earned lifetime   = rows where payPeriodEnd <= TODAY and non-null
//                     = 500 (r1) + 300 (r2) + 200 (r5) + 0 (r6) = 1000
//                       (r3 future excluded; r4 null excluded)
//   Earned YTD        = rows where payPeriodEnd in [2026-01-01, TODAY]
//                     = 300 (r2) + 200 (r5) = 500
//   Collected         = rows where collectionDate is set
//                     = 400 (r1) + 100 (r3) + 75 (r6) = 575

const EXPECTED_EARNED_LIFETIME = 1000
const EXPECTED_EARNED_YTD = 500
const EXPECTED_COLLECTED = 575

// ─── Mocks for the server-action surface ───────────────────────
//
// `getContract` is exercised against the same FIXTURE by mocking Prisma.
// We reuse the shape used by `@/lib/actions/__tests__/get-contract-rebate-ytd.test.ts`.

let contractRow: {
  id: string
  vendorId: string
  facilityId: string
  rebates: Row[]
  periods: Array<{ id: string }>
} | null = null

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findUniqueOrThrow: vi.fn(async () => {
        if (!contractRow) throw new Error("not found")
        return contractRow
      }),
    },
    contractPeriod: {
      findFirst: vi.fn(async () => null),
      aggregate: vi.fn(async () => ({ _sum: { totalSpend: 0 } })),
    },
    cOGRecord: {
      aggregate: vi.fn(async () => ({ _sum: { extendedPrice: 0 } })),
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

describe("parity: canonical reducer sanity", () => {
  it("canonical helpers return the hand-computed totals for FIXTURE", () => {
    expect(sumEarnedRebatesLifetime(FIXTURE, TODAY)).toBe(
      EXPECTED_EARNED_LIFETIME,
    )
    expect(sumEarnedRebatesYTD(FIXTURE, TODAY)).toBe(EXPECTED_EARNED_YTD)
    expect(sumCollectedRebates(FIXTURE)).toBe(EXPECTED_COLLECTED)
  })
})

describe("parity: invariants between reducers", () => {
  // These are "shape" assertions — they hold for ANY valid fixture, not
  // just this one. If sumEarnedRebatesLifetime ever goes below
  // sumEarnedRebatesYTD, an earned reducer has drifted. If
  // sumCollectedRebates exceeds sumEarnedRebatesLifetime on a contract
  // where every collected row has a closed payPeriodEnd, it's a data-model
  // violation (collected cannot exceed earned for rows that have closed).
  it("Earned lifetime >= Earned YTD (lifetime is a strict superset)", () => {
    expect(sumEarnedRebatesLifetime(FIXTURE, TODAY)).toBeGreaterThanOrEqual(
      sumEarnedRebatesYTD(FIXTURE, TODAY),
    )
  })

  it("Earned lifetime >= Collected (for rows whose payPeriodEnd <= today)", () => {
    // Restrict the fixture to rows whose pay-period has closed — collected
    // CAN legitimately exceed earned on fresh-adjustment rows
    // (r-future-but-collected), but once we drop future rows the invariant
    // holds. This asserts the invariant as it applies on a per-surface basis
    // (the detail header scopes to closed periods, not future ones).
    const closedOnly = FIXTURE.filter((r) => {
      if (r.payPeriodEnd == null) return false
      return r.payPeriodEnd <= TODAY
    })
    const earnedClosed = sumEarnedRebatesLifetime(closedOnly, TODAY)
    const collectedClosed = sumCollectedRebates(closedOnly)
    expect(earnedClosed).toBeGreaterThanOrEqual(collectedClosed)
  })
})

describe("parity: Earned YTD across surfaces", () => {
  // Every surface that renders "Rebates Earned (YTD)" MUST go through
  // `sumEarnedRebatesYTD` (see CLAUDE.md canonical reducers). This block
  // enumerates each such surface and asserts it returns the canonical
  // value for FIXTURE.
  //
  // Add a line here whenever you introduce a new "Earned YTD" surface.

  it("canonical helper: sumEarnedRebatesYTD(FIXTURE, TODAY)", () => {
    expect(sumEarnedRebatesYTD(FIXTURE, TODAY)).toBe(EXPECTED_EARNED_YTD)
  })

  it("surface: getContract(id).rebateEarnedYTD", async () => {
    // Dynamic import so the module picks up the Prisma mock from above.
    const { getContract } = await import("@/lib/actions/contracts")
    contractRow = {
      id: FIXTURE_CONTRACT_ID,
      vendorId: "v-parity",
      facilityId: "fac-test",
      rebates: FIXTURE,
      periods: [],
    }
    const result = (await getContract(FIXTURE_CONTRACT_ID)) as {
      rebateEarnedYTD: number
    }
    // NOTE: getContract uses `new Date()` (not TODAY) internally, so this
    // value is only equal to EXPECTED_EARNED_YTD when the test executes on
    // 2026-04-19 or later in 2026. We pin the fixture's "closed YTD" rows
    // to fall within any plausible run window from 2026-04-19 onward, so
    // the assertion holds deterministically as long as the year is 2026+.
    // To keep this a tight parity check across the full fixture, we
    // recompute the expected value against the same `today` getContract
    // observes — which is sufficient to assert the helper is the single
    // source of truth (the goal).
    const runtimeToday = new Date()
    const expected = sumEarnedRebatesYTD(
      FIXTURE as readonly EarnedRebateLike[],
      runtimeToday,
    )
    expect(result.rebateEarnedYTD).toBe(expected)
  })

  // When the contracts-list "earned" column is extracted into a
  // framework-free helper, add a line here that exercises it against
  // FIXTURE. (Today it's computed inline inside `getContracts` via the
  // same `sumEarnedRebatesYTD` call — no separate surface to test.)
})

describe("parity: Collected across surfaces", () => {
  // Every surface that renders "Rebates Collected" MUST go through
  // `sumCollectedRebates` (see CLAUDE.md canonical reducers). Enumerate
  // each surface and assert it matches the canonical helper against FIXTURE.

  it("canonical helper: sumCollectedRebates(FIXTURE)", () => {
    expect(sumCollectedRebates(FIXTURE)).toBe(EXPECTED_COLLECTED)
  })

  it("surface: getContract(id).rebateCollected", async () => {
    const { getContract } = await import("@/lib/actions/contracts")
    contractRow = {
      id: FIXTURE_CONTRACT_ID,
      vendorId: "v-parity",
      facilityId: "fac-test",
      rebates: FIXTURE,
      periods: [],
    }
    const result = (await getContract(FIXTURE_CONTRACT_ID)) as {
      rebateCollected: number
    }
    expect(result.rebateCollected).toBe(EXPECTED_COLLECTED)
  })

  it("surface: Transactions tab summary (sumDisplayedCollected)", () => {
    // The ledger wraps each Rebate row as a `PeriodRow` with `source="rebate"`
    // before handing it to `sumDisplayedCollected`. ContractPeriod-sourced
    // rows short-circuit to $0 so they don't affect the collected total.
    const rows: PeriodRow[] = FIXTURE.map((r) => ({
      id: r.id,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      totalSpend: 0,
      rebateEarned: r.rebateEarned,
      rebateCollected: r.rebateCollected,
      tierAchieved: null,
      source: "rebate",
      collectionDate: r.collectionDate ? r.collectionDate.toISOString() : null,
      notes: null,
    }))
    expect(sumDisplayedCollected(rows)).toBe(EXPECTED_COLLECTED)
  })

  it("surface: ContractPeriod rows do not affect collected total", () => {
    // A ledger that mixes ContractPeriod rows with Rebate rows must still
    // only count collected on Rebate rows. This is the invariant that
    // broke in pre-W1.R when the client chunk cached a reducer that also
    // summed ContractPeriod.rebateCollected.
    const mixed: PeriodRow[] = [
      ...FIXTURE.map<PeriodRow>((r) => ({
        id: r.id,
        periodStart: "2026-01-01",
        periodEnd: "2026-12-31",
        totalSpend: 0,
        rebateEarned: r.rebateEarned,
        rebateCollected: r.rebateCollected,
        tierAchieved: null,
        source: "rebate",
        collectionDate: r.collectionDate
          ? r.collectionDate.toISOString()
          : null,
        notes: null,
      })),
      // Synthesized ContractPeriod row — has rebateCollected but no
      // collectionDate. Canonical filter must exclude it.
      {
        id: "period-synth",
        periodStart: "2026-01-01",
        periodEnd: "2026-03-31",
        totalSpend: 123_456,
        rebateEarned: 888,
        rebateCollected: 9_999,
        tierAchieved: 2,
        source: "period",
        collectionDate: null,
        notes: null,
      },
    ]
    expect(sumDisplayedCollected(mixed)).toBe(EXPECTED_COLLECTED)
  })
})

describe("parity: Earned Lifetime across surfaces", () => {
  // "Total Rebates (Lifetime)" — today this renders only on the
  // Transactions tab summary card and the reports overview, both of which
  // call `sumEarnedRebatesLifetime` directly. This block will grow as
  // more surfaces adopt the helper.

  it("canonical helper: sumEarnedRebatesLifetime(FIXTURE, TODAY)", () => {
    expect(sumEarnedRebatesLifetime(FIXTURE, TODAY)).toBe(
      EXPECTED_EARNED_LIFETIME,
    )
  })

  it("surface: getContract(id).rebateEarned matches helper on same input", async () => {
    const { getContract } = await import("@/lib/actions/contracts")
    contractRow = {
      id: FIXTURE_CONTRACT_ID,
      vendorId: "v-parity",
      facilityId: "fac-test",
      rebates: FIXTURE,
      periods: [],
    }
    const result = (await getContract(FIXTURE_CONTRACT_ID)) as {
      rebateEarned: number
    }
    // Same caveat as YTD: getContract uses `new Date()`. We recompute
    // against the runtime `today` so we're asserting the helper is the
    // single source of truth, not a pinned-date value.
    const runtimeToday = new Date()
    const expected = sumEarnedRebatesLifetime(
      FIXTURE as readonly EarnedRebateLike[],
      runtimeToday,
    )
    expect(result.rebateEarned).toBe(expected)
  })
})

describe("parity: fixture shape lint", () => {
  // Self-check: make sure the fixture actually exercises every branch the
  // canonical helpers filter on. If you delete a row from FIXTURE, these
  // sentinels will fail and force you to think about what invariant you
  // just weakened.
  it("contains a null-payPeriodEnd row", () => {
    expect(FIXTURE.some((r) => r.payPeriodEnd === null)).toBe(true)
  })
  it("contains a future-dated payPeriodEnd row", () => {
    expect(
      FIXTURE.some(
        (r) => r.payPeriodEnd !== null && r.payPeriodEnd > TODAY,
      ),
    ).toBe(true)
  })
  it("contains a prior-year closed row", () => {
    expect(
      FIXTURE.some(
        (r) =>
          r.payPeriodEnd !== null &&
          r.payPeriodEnd.getUTCFullYear() < TODAY.getUTCFullYear(),
      ),
    ).toBe(true)
  })
  it("contains a collected-but-not-yet-earned row", () => {
    expect(
      FIXTURE.some(
        (r) =>
          r.collectionDate !== null &&
          r.payPeriodEnd !== null &&
          r.payPeriodEnd > TODAY,
      ),
    ).toBe(true)
  })
  it("contains an uncollected row", () => {
    expect(FIXTURE.some((r) => r.collectionDate === null)).toBe(true)
  })
})

// ─── Type imports referenced above ─────────────────────────────
// Avoid "unused" errors when the parity tests don't touch certain types.
export type _ReferencedTypes = CollectedRebateLike | EarnedRebateLike
