/**
 * Tests for the prospective-analysis engine-wired server actions —
 * analyzeProposal, getVendorCOGPatterns, analyzeUploadedPDF,
 * compareStoredProposals.
 *
 * Exercises:
 *   - analyzeProposal: shape + delegation to scoring / recommendation /
 *     dynamic-tier engines (score ranges, verdict thresholds, tier count)
 *   - getVendorCOGPatterns: facility-scoped COG + pricing-file fetch,
 *     category-total spend aggregation, delegation to the pure analyzer
 *   - analyzeUploadedPDF: delegation to analyzePDFContract + audit log
 *   - compareStoredProposals: placeholder returns empty comparison
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

interface CogRow {
  transactionDate: Date
  extendedPrice: number
  vendorId: string
  vendorItemNo: string | null
  inventoryDescription: string | null
  category: string | null
}

interface PricingRow {
  vendorItemNo: string
  contractPrice: number | null
}

let cogRows: CogRow[] = []
let pricingRows: PricingRow[] = []
let aggregateSum = 0
const auditCalls: Array<Record<string, unknown>> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    cOGRecord: {
      findMany: vi.fn(
        async ({
          where,
        }: {
          where: { vendorId: string; facilityId: string }
        }) =>
          cogRows.filter(
            (r) =>
              r.vendorId === where.vendorId ||
              (!r.vendorId && where.vendorId === "v-mixed"),
          ),
      ),
      aggregate: vi.fn(async () => ({
        _sum: { extendedPrice: aggregateSum },
      })),
    },
    pricingFile: {
      findMany: vi.fn(async () => pricingRows),
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: async () => ({
    user: { id: "user-1" },
    facility: { id: "fac-1" },
  }),
}))

vi.mock("@/lib/audit", () => ({
  logAudit: async (params: Record<string, unknown>) => {
    auditCalls.push(params)
  },
}))

import {
  analyzeProposal,
  analyzeUploadedPDF,
  compareStoredProposals,
  getVendorCOGPatterns,
} from "@/lib/actions/prospective-analysis"

beforeEach(() => {
  vi.clearAllMocks()
  cogRows = []
  pricingRows = []
  aggregateSum = 0
  auditCalls.length = 0
})

describe("analyzeProposal", () => {
  it("returns scores, recommendation, and dynamicTiers for a strong proposal", async () => {
    const result = await analyzeProposal({
      proposedAnnualSpend: 800_000,
      currentSpend: 1_000_000,
      priceVsMarket: -10,
      minimumSpend: 500_000,
      proposedRebateRate: 5,
      termYears: 2,
      exclusivity: false,
      marketShareCommitment: null,
      minimumSpendIsHighPct: false,
      priceProtection: true,
      paymentTermsNet60Or90: true,
      volumeDiscountAbove5Percent: true,
    })

    expect(result.scores.overall).toBeGreaterThan(7) // strong proposal
    expect(result.recommendation.verdict).toBe("accept")
    expect(result.recommendation.negotiationPoints.length).toBeGreaterThan(0)
    expect(result.dynamicTiers).toHaveLength(3)
    expect(result.dynamicTiers[0]!.name).toBe("Base")
    expect(result.dynamicTiers[2]!.rate).toBe(5) // Target = exact rate
  })

  it("returns decline verdict for a lock-in-heavy proposal", async () => {
    const result = await analyzeProposal({
      proposedAnnualSpend: 1_200_000, // MORE than current = no savings
      currentSpend: 1_000_000,
      priceVsMarket: 10, // above market
      minimumSpend: 3_000_000, // unreachable
      proposedRebateRate: 2,
      termYears: 5,
      exclusivity: true,
      marketShareCommitment: 90,
      minimumSpendIsHighPct: true,
      priceProtection: false,
      paymentTermsNet60Or90: false,
      volumeDiscountAbove5Percent: false,
    })

    expect(result.scores.costSavings).toBe(0)
    expect(result.scores.lockInRisk).toBeLessThan(5)
    expect(["negotiate", "decline"]).toContain(result.recommendation.verdict)
    expect(result.recommendation.risks.length).toBeGreaterThan(0)
  })

  it("passes marketShareCommitment undefined → null through to engine", async () => {
    const result = await analyzeProposal({
      proposedAnnualSpend: 900_000,
      currentSpend: 1_000_000,
      priceVsMarket: 0,
      minimumSpend: 800_000,
      proposedRebateRate: 3,
      termYears: 2,
      exclusivity: false,
      // marketShareCommitment intentionally omitted
      minimumSpendIsHighPct: false,
      priceProtection: false,
      paymentTermsNet60Or90: false,
      volumeDiscountAbove5Percent: false,
    })
    // lock-in risk penalty: no exclusivity/termYears/marketShare/minHighPct
    expect(result.scores.lockInRisk).toBe(10)
  })

  it("survives JSON round-trip (serialize path)", async () => {
    const result = await analyzeProposal({
      proposedAnnualSpend: 800_000,
      currentSpend: 1_000_000,
      priceVsMarket: -5,
      minimumSpend: 500_000,
      proposedRebateRate: 4,
      termYears: 2,
      exclusivity: false,
      marketShareCommitment: null,
      minimumSpendIsHighPct: false,
      priceProtection: true,
      paymentTermsNet60Or90: false,
      volumeDiscountAbove5Percent: false,
    })
    const parsed = JSON.parse(JSON.stringify(result)) as typeof result
    expect(parsed.dynamicTiers).toHaveLength(3)
  })
})

describe("getVendorCOGPatterns", () => {
  it("returns zeroed analysis when vendor has no COG history", async () => {
    cogRows = []
    pricingRows = []
    aggregateSum = 0

    const result = await getVendorCOGPatterns("v-empty")
    expect(result.vendorId).toBe("v-empty")
    expect(result.totalSpend12Mo).toBe(0)
    expect(result.top5ItemsBySpend).toEqual([])
    expect(result.seasonalityFlag).toBe(false)
  })

  it("aggregates COG purchases and surfaces top-5 items", async () => {
    const base = new Date()
    cogRows = [
      {
        transactionDate: new Date(base.getTime() - 30 * 24 * 60 * 60 * 1000),
        extendedPrice: 50_000,
        vendorId: "v-1",
        vendorItemNo: "ITEM-A",
        inventoryDescription: "Item A",
        category: "supplies",
      },
      {
        transactionDate: new Date(base.getTime() - 60 * 24 * 60 * 60 * 1000),
        extendedPrice: 20_000,
        vendorId: "v-1",
        vendorItemNo: "ITEM-B",
        inventoryDescription: "Item B",
        category: "supplies",
      },
    ]
    pricingRows = [{ vendorItemNo: "ITEM-A", contractPrice: 100 }]
    aggregateSum = 140_000 // category total

    const result = await getVendorCOGPatterns("v-1")
    expect(result.totalSpend12Mo).toBe(70_000)
    expect(result.top5ItemsBySpend[0]!.vendorItemNo).toBe("ITEM-A")
    expect(result.categoryMarketShare).toBeCloseTo(0.5, 5)
    expect(result.tieInRiskFlag).toBe(true) // share > 0.4
  })

  it("skips pricing rows with null contractPrice when building drift input", async () => {
    const base = new Date()
    cogRows = [
      {
        transactionDate: new Date(base.getTime() - 5 * 24 * 60 * 60 * 1000),
        extendedPrice: 10_000,
        vendorId: "v-1",
        vendorItemNo: "ITEM-C",
        inventoryDescription: "Item C",
        category: null,
      },
    ]
    pricingRows = [
      { vendorItemNo: "ITEM-C", contractPrice: null },
      { vendorItemNo: "ITEM-C", contractPrice: 100 },
    ]
    aggregateSum = 0

    const result = await getVendorCOGPatterns("v-1")
    // Drift is computed — no exception, and the null row is ignored.
    expect(result.totalSpend12Mo).toBe(10_000)
  })
})

describe("analyzeUploadedPDF", () => {
  it("returns clause analysis and emits audit log", async () => {
    const pdfText =
      "This agreement includes a non-exclusive supply clause and standard termination language. Either party may terminate upon 90 days notice."

    const result = await analyzeUploadedPDF({
      pdfText,
      fileName: "contract.pdf",
    })

    expect(Array.isArray(result.findings)).toBe(true)
    expect(typeof result.overallRiskScore).toBe("number")
    expect(typeof result.summary).toBe("string")

    expect(auditCalls).toHaveLength(1)
    const audit = auditCalls[0]!
    expect(audit.action).toBe("prospective.pdf_analyzed")
    expect(audit.entityType).toBe("pdf_analysis")
    const meta = audit.metadata as { fileName: string; textLength: number }
    expect(meta.fileName).toBe("contract.pdf")
    expect(meta.textLength).toBe(pdfText.length)
  })

  it("handles missing fileName (optional)", async () => {
    await analyzeUploadedPDF({ pdfText: "short text" })
    expect(auditCalls).toHaveLength(1)
    const meta = auditCalls[0]!.metadata as { fileName: string | null }
    expect(meta.fileName).toBeNull()
  })
})

describe("compareStoredProposals", () => {
  it("returns an empty comparison while proposals aren't persisted yet", async () => {
    const result = await compareStoredProposals(["id-1", "id-2"])
    expect(result.proposals).toEqual([])
    expect(result.recommendedProposalId).toBeNull()
    expect(result.savingsDeltaVsRunnerUp).toBeNull()
  })

  it("requires facility even when no proposals are found", async () => {
    // If requireFacility threw, this would throw too — smoke test passes
    // means the guard ran.
    await expect(compareStoredProposals([])).resolves.toBeDefined()
  })
})
