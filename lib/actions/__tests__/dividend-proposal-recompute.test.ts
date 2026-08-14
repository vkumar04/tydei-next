import { describe, it, expect, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * `DividendProposal.verdict` / `.annualDividendImpact` / `.netPresentValue` /
 * `.paybackYears` / `.noiImpact` are a write-through CACHE of
 * `resolveDividendProposalSummary` over `payload`, never a second source of
 * truth. A row written before an engine change holds the OLD definition of the
 * metric — on 2026-08-13 `annualDividendImpact` went from the operating figure
 * to `operating − annualCapitalCharge`, which flips the verdict for a
 * capital-heavy purchase.
 *
 * Two things must stay true, and neither is enforced by the type system:
 *   1. the read path derives from `payload` and ignores the columns, and
 *   2. nothing re-adds those columns to a `select`, `where` or `orderBy`,
 *      which would silently reintroduce the staleness through the back door.
 */

const { proposalFindManyMock, requireVendorMock } = vi.hoisted(() => ({
  proposalFindManyMock: vi.fn(),
  requireVendorMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: { dividendProposal: { findMany: proposalFindManyMock } },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireVendor: requireVendorMock,
}))

vi.mock("@/lib/serialize", () => ({
  serialize: <T,>(v: T): T => v,
}))

import { listDividendProposals } from "@/lib/actions/dividend-proposals"
import {
  DEFAULT_PROFORMA_LINE_ITEMS,
  EMPTY_PURCHASE_SCENARIO,
} from "@/lib/financial-analysis/proforma-pnl"

/** A $5M outlay: operations alone are accretive, the net figure is dilutive. */
const CAPITAL_HEAVY_PAYLOAD = {
  lineItems: DEFAULT_PROFORMA_LINE_ITEMS,
  purchase: {
    ...EMPTY_PURCHASE_SCENARIO,
    productName: "Robot",
    incrementalCases: 200,
    recurringAnnualCost: 120_000,
    capitalOutlay: 5_000_000,
  },
  payorGroupNames: [],
  quarterEdits: {},
  percentOfMedicare: 120,
  medicareRateOverride: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  requireVendorMock.mockResolvedValue({
    vendor: { id: "v-1" },
    user: { id: "u-1" },
  })
})

describe("listDividendProposals — derives, never reads the cache columns", () => {
  it("returns the recomputed figures even when the stored columns disagree", async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: "p-1",
        name: "Robot",
        facilityKey: null,
        facilityLabel: "Lighthouse Surgical Center",
        payload: CAPITAL_HEAVY_PAYLOAD,
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
        // What a pre-capital-charge save would have written.
        verdict: "accretive",
        annualDividendImpact: 354_838.4,
      },
    ])

    const [row] = await listDividendProposals()

    expect(row.recomputed).toBe(true)
    // The current definition: operating 354,838.40 − capital 1,000,000.
    expect(row.annualDividendImpact).toBe(-645_161.6)
    expect(row.verdict).toBe("dilutive")
    // The stale column values must not survive anywhere on the item.
    expect(row.annualDividendImpact).not.toBe(354_838.4)
    expect(row.verdict).not.toBe("accretive")
  })

  it("reports recomputed:false with null figures when the payload can't drive the engine", async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: "p-2",
        name: "Drifted",
        facilityKey: null,
        facilityLabel: "Lighthouse Surgical Center",
        payload: { lineItems: "not-a-statement" },
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ])

    const [row] = await listDividendProposals()

    expect(row.recomputed).toBe(false)
    // Null, never 0 — "+$0" reads as a real computed result.
    expect(row.annualDividendImpact).toBeNull()
    expect(row.netPresentValue).toBeNull()
    expect(row.paybackYears).toBeNull()
    expect(row.noiImpact).toBeNull()
    expect(row.verdict).toBeNull()
  })

  it("never leaks the payload or the vendorId to the client", async () => {
    proposalFindManyMock.mockResolvedValue([
      {
        id: "p-3",
        name: "Robot",
        facilityKey: null,
        facilityLabel: "Lighthouse Surgical Center",
        payload: CAPITAL_HEAVY_PAYLOAD,
        vendorId: "v-1",
        createdAt: new Date("2026-08-01T00:00:00Z"),
        updatedAt: new Date("2026-08-01T00:00:00Z"),
      },
    ])

    const [row] = await listDividendProposals()

    expect(row).not.toHaveProperty("payload")
    expect(row).not.toHaveProperty("vendorId")
  })
})

describe("the cache columns stay out of every Prisma clause", () => {
  const SOURCE = readFileSync(
    join(process.cwd(), "lib/actions/dividend-proposals.ts"),
    "utf8",
  )

  const CACHE_COLUMNS = [
    "verdict",
    "annualDividendImpact",
    "netPresentValue",
    "paybackYears",
    "noiImpact",
  ] as const

  it("LIST_SELECT reads the payload and none of the cache columns", () => {
    const listSelect = SOURCE.match(/const LIST_SELECT = \{[^}]*\}/)?.[0]
    expect(listSelect, "LIST_SELECT should be findable").toBeTruthy()
    expect(listSelect).toContain("payload: true")
    for (const column of CACHE_COLUMNS) {
      expect(
        listSelect,
        `${column} is a stale cache of the payload — derive it with resolveDividendProposalSummary instead of selecting it`,
      ).not.toContain(`${column}: true`)
    }
  })

  it("no where/orderBy clause filters or sorts on a cache column", () => {
    // An orderBy on a derived-elsewhere column silently ranks rows by a value
    // that may predate the current engine; a where silently drops them.
    const clauses = SOURCE.match(/(where|orderBy):\s*\{[^}]*\}/g) ?? []
    for (const clause of clauses) {
      for (const column of CACHE_COLUMNS) {
        expect(
          clause,
          `${column} appears in a Prisma clause — it is a cache, not a source of truth`,
        ).not.toContain(column)
      }
    }
  })
})
