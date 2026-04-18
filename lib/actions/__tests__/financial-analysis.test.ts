/**
 * Tests for `analyzeCapitalContract` — the server action that wires the
 * pure financial-analysis engines (ROI, clause-risk adjustment,
 * narrative builder) onto Prisma-backed contract data.
 *
 * Mock strategy mirrors `alerts-server.test.ts` / `dashboard.test.ts`:
 * hand-roll a prisma mock backed by mutable fixtures, then exercise the
 * action end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── Fixtures ────────────────────────────────────────────────────

type ContractFixture = {
  id: string
  name: string
  totalValue: number
  effectiveDate: Date
  expirationDate: Date
  vendor: { name: string } | null
  documents: Array<{
    id: string
    indexStatus: string
    pages: Array<{ text: string; pageNumber: number }>
  }>
}

let contractFixture: ContractFixture | null = null
const notFoundError = new Error("contract not found")

// ─── Prisma mock ─────────────────────────────────────────────────

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      findFirstOrThrow: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id: string; OR?: unknown }
          select: {
            documents?: {
              where?: { indexStatus?: string }
            }
          }
        }) => {
          if (!contractFixture || contractFixture.id !== where.id) {
            throw notFoundError
          }
          const wantIndexed =
            select.documents?.where?.indexStatus === "indexed"
          const documents = wantIndexed
            ? contractFixture.documents.filter(
                (d) => d.indexStatus === "indexed",
              )
            : contractFixture.documents
          return {
            id: contractFixture.id,
            name: contractFixture.name,
            totalValue: contractFixture.totalValue,
            effectiveDate: contractFixture.effectiveDate,
            expirationDate: contractFixture.expirationDate,
            vendor: contractFixture.vendor,
            documents: documents.map((d) => ({
              id: d.id,
              pages: d.pages
                .slice()
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((p) => ({ text: p.text })),
            })),
          }
        },
      ),
    },
  },
}))

// ─── auth mock ───────────────────────────────────────────────────

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-1" },
    user: { id: "user-1" },
  })),
}))

// ─── Imports under test ──────────────────────────────────────────

import { analyzeCapitalContract } from "@/lib/actions/financial-analysis"

// ─── Helpers ─────────────────────────────────────────────────────

function mkContract(overrides: Partial<ContractFixture> = {}): ContractFixture {
  return {
    id: "c-1",
    name: "Acme CT Scanner Capital",
    totalValue: 1_000_000,
    effectiveDate: new Date("2025-01-01T00:00:00Z"),
    expirationDate: new Date("2030-01-01T00:00:00Z"), // 5 years
    vendor: { name: "Acme Imaging" },
    documents: [],
    ...overrides,
  }
}

const baseInput = {
  contractId: "c-1",
  discountRate: 0.08,
  taxRate: 0.21,
  annualSpend: 250_000,
  rebateRate: 0.04,
  growthRatePerYear: 0.02,
  marketDeclineRate: 0.03,
  payUpfront: true,
}

beforeEach(() => {
  vi.clearAllMocks()
  contractFixture = null
})

// ─── analyzeCapitalContract ─────────────────────────────────────

describe("analyzeCapitalContract", () => {
  it("returns roi + narrative + null riskAdjustedNPV when no indexed PDF", async () => {
    contractFixture = mkContract()
    const result = await analyzeCapitalContract(baseInput)

    // ROI shape: full engine output.
    expect(result.roi).toBeDefined()
    expect(Array.isArray(result.roi.cashflows)).toBe(true)
    expect(result.roi.cashflows).toHaveLength(6) // years + 1
    expect(result.roi.depreciation.length).toBeGreaterThan(0)
    expect(result.roi.rebates).toHaveLength(5)

    // Narrative shape: deterministic engine output.
    expect(result.narrative).toBeDefined()
    expect(result.narrative.headline).toContain("Acme CT Scanner Capital")
    expect(["strong", "moderate", "weak", "negative"]).toContain(
      result.narrative.verdict,
    )
    expect(result.narrative.bullets.length).toBeGreaterThan(0)

    // No PDF → no risk adjustment.
    expect(result.riskAdjustedNPV).toBeNull()
  })

  it("derives contract term years from effective/expiration dates", async () => {
    // 3-year contract
    contractFixture = mkContract({
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2028-01-01T00:00:00Z"),
    })
    const result = await analyzeCapitalContract(baseInput)
    // cashflows length = years + 1 = 4
    expect(result.roi.cashflows).toHaveLength(4)
    expect(result.roi.rebates).toHaveLength(3)
    expect(result.narrative.bullets[0]).toContain("3 years")
  })

  it("uses contract.totalValue as capitalCost in ROI", async () => {
    contractFixture = mkContract({ totalValue: 500_000 })
    const result = await analyzeCapitalContract({
      ...baseInput,
      payUpfront: true,
    })
    // cashflows[0] is the upfront outlay (negative capital cost).
    expect(result.roi.cashflows[0]).toBe(-500_000)
  })

  it("applies clause-risk adjustment when the contract has an indexed PDF with found clauses", async () => {
    // PDF text that hits clause-library regex for auto-renewal + exclusivity.
    const pdfText = `
      This Agreement shall automatically renew for successive one (1) year
      terms unless either party gives written notice of non-renewal.
      Buyer agrees that Vendor shall be the exclusive supplier of all
      covered products during the Term. Buyer shall not purchase from any
      competitor.
      Seller reserves the right to adjust pricing unilaterally.
    `
    contractFixture = mkContract({
      documents: [
        {
          id: "doc-1",
          indexStatus: "indexed",
          pages: [{ pageNumber: 1, text: pdfText }],
        },
      ],
    })
    const result = await analyzeCapitalContract(baseInput)
    expect(result.riskAdjustedNPV).not.toBeNull()
    expect(result.riskAdjustedNPV!.adjustments.length).toBeGreaterThan(0)
    // baseNPV must equal the ROI NPV.
    expect(result.riskAdjustedNPV!.baseNPV).toBe(result.roi.npv)
    // The narrative surfaces the adjusted NPV in a bullet.
    const adjBullet = result.narrative.bullets.find((b) =>
      b.includes("risk-adjusted"),
    )
    expect(adjBullet).toBeDefined()
  })

  it("skips clause-risk adjustment when the indexed PDF has no matched clauses", async () => {
    contractFixture = mkContract({
      documents: [
        {
          id: "doc-1",
          indexStatus: "indexed",
          pages: [
            { pageNumber: 1, text: "The quick brown fox jumps over lazy dog." },
          ],
        },
      ],
    })
    const result = await analyzeCapitalContract(baseInput)
    expect(result.riskAdjustedNPV).toBeNull()
  })

  it("ignores documents whose indexStatus is not 'indexed'", async () => {
    contractFixture = mkContract({
      documents: [
        {
          id: "doc-1",
          indexStatus: "pending",
          pages: [
            {
              pageNumber: 1,
              text: "This Agreement shall automatically renew for successive terms unless written notice.",
            },
          ],
        },
      ],
    })
    const result = await analyzeCapitalContract(baseInput)
    // pending document is filtered out by the where clause in the mock.
    expect(result.riskAdjustedNPV).toBeNull()
  })

  it("scopes the lookup to the caller's facility (findFirstOrThrow rejects foreign contracts)", async () => {
    // No fixture set → the mock throws notFoundError regardless of the
    // contractId, which matches the real behavior when a contract isn't
    // owned by the caller's facility.
    await expect(
      analyzeCapitalContract({ ...baseInput, contractId: "c-foreign" }),
    ).rejects.toBe(notFoundError)
  })

  it("produces a narrative whose verdict aligns with the computed NPV / capital ratio", async () => {
    // Force a strong positive NPV: high rebate, low market decline, long term.
    contractFixture = mkContract({
      totalValue: 100_000,
      effectiveDate: new Date("2025-01-01T00:00:00Z"),
      expirationDate: new Date("2031-01-01T00:00:00Z"),
    })
    const result = await analyzeCapitalContract({
      ...baseInput,
      annualSpend: 2_000_000,
      rebateRate: 0.1,
      marketDeclineRate: 0,
      payUpfront: true,
    })
    expect(["strong", "moderate"]).toContain(result.narrative.verdict)
    expect(result.narrative.cta.length).toBeGreaterThan(0)
  })
})
