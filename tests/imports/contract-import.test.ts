/**
 * End-to-end test for ingestExtractedContracts.
 *
 * The input is AI-extracted RichContractExtractData (not CSV) — a PDF
 * upload is first OCR'd + structured by Claude upstream, then this
 * action persists the structured output as Contract + ContractTerm +
 * ContractTier rows.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const contractCreates: Array<Record<string, unknown>> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        contractCreates.push(data)
        return { id: `c-${contractCreates.length}`, name: String(data.name) }
      }),
    },
    vendor: { update: vi.fn(async () => ({})) },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(async () => ({
    facility: { id: "fac-test" },
    user: { id: "user-test" },
  })),
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn(async () => {}) }))

vi.mock("@/lib/vendors/resolve", () => ({
  resolveVendorId: vi.fn(async (name: string | null) => {
    if (!name) return "v-unknown"
    return `v-${name.replace(/\s+/g, "-").toLowerCase()}`
  }),
}))

vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))

import { ingestExtractedContracts } from "@/lib/actions/imports/contract-import"
import type { RichContractExtractData } from "@/lib/ai/schemas"

const validExtracted: RichContractExtractData = {
  contractName: "Arthrex 2026 Master Agreement",
  vendorName: "Arthrex",
  vendorDivision: "Orthopedics",
  contractId: "CTR-2026-ART",
  contractType: "usage",
  effectiveDate: "2026-01-01",
  expirationDate: "2028-12-31",
  rebatePayPeriod: "quarterly",
  isGroupedContract: false,
  facilities: [{ name: "Lighthouse Surgical", city: null, state: null }],
  specialConditions: ["Price protection for 24 months"],
  terms: [
    {
      termName: "Tiered Spend Rebate",
      termType: "spend_rebate",
      effectiveFrom: "2026-01-01",
      effectiveTo: "2028-12-31",
      performancePeriod: "annual",
      tiers: [
        {
          tierNumber: 1,
          spendMin: 0,
          spendMax: 500000,
          rebateType: "percent_of_spend",
          rebateValue: 2,
        },
        {
          tierNumber: 2,
          spendMin: 500000,
          spendMax: null,
          rebateType: "percent_of_spend",
          rebateValue: 4,
        },
      ],
    },
  ],
  tieInDetails: {
    capitalEquipmentValue: 250000,
  },
} as RichContractExtractData

beforeEach(() => {
  vi.clearAllMocks()
  contractCreates.length = 0
})

describe("ingestExtractedContracts — happy path", () => {
  it("creates a Contract + nested terms + tiers from a single extraction", async () => {
    const result = await ingestExtractedContracts([
      { extracted: validExtracted, sourceFilename: "arthrex-2026.pdf" },
    ])

    expect(result.created).toBe(1)
    expect(result.failed).toBe(0)
    expect(result.results[0]).toMatchObject({
      ok: true,
      name: "Arthrex 2026 Master Agreement",
    })

    const c = contractCreates[0]
    expect(c.name).toBe("Arthrex 2026 Master Agreement")
    expect(c.contractNumber).toBe("CTR-2026-ART")
    expect(c.vendorId).toBe("v-arthrex")
    expect(c.facilityId).toBe("fac-test")
    expect(c.contractType).toBe("usage")
    expect(c.status).toBe("active")
    expect(Number(c.totalValue)).toBe(250000)
    expect(c.isMultiFacility).toBe(false)

    // Nested terms+tiers must be there
    const terms = (c.terms as { create: Array<Record<string, unknown>> })
      .create
    expect(terms).toHaveLength(1)
    expect(terms[0].termType).toBe("spend_rebate")
    const tiers = (terms[0].tiers as { create: Array<Record<string, unknown>> })
      .create
    expect(tiers).toHaveLength(2)
    expect(tiers[0].tierNumber).toBe(1)
    // Charles R5.25 — percent_of_spend is stored as a fraction, so the
    // AI's "2" (meaning 2%) is normalized to 0.02 on ingest.
    expect(Number(tiers[0].rebateValue)).toBe(0.02)
    expect(Number(tiers[1].rebateValue)).toBe(0.04)
  })

  it("derives display name from sourceFilename when contractName is missing", async () => {
    const extracted = { ...validExtracted, contractName: "" }
    const result = await ingestExtractedContracts([
      { extracted, sourceFilename: "stryker_knee_agmt_2026.pdf" },
    ])

    expect(result.results[0]).toMatchObject({ ok: true })
    // filename stripped of extension + hyphens/underscores → spaces
    expect(contractCreates[0].name).toBe("stryker knee agmt 2026")
  })

  it("falls back to 'Untitled Contract' when both contractName and filename are missing", async () => {
    const extracted = { ...validExtracted, contractName: "" }
    const result = await ingestExtractedContracts([{ extracted }])

    expect(result.results[0]).toMatchObject({ ok: true })
    expect(contractCreates[0].name).toBe("Untitled Contract")
  })

  it("creates contract without terms when extracted.terms is empty", async () => {
    const extracted = { ...validExtracted, terms: [] }
    await ingestExtractedContracts([{ extracted }])

    const c = contractCreates[0]
    // When terms is empty, the `terms: { create: [...] }` block is omitted
    expect(c.terms).toBeUndefined()
  })

  it("defaults unknown contractType to 'usage'", async () => {
    const extracted = {
      ...validExtracted,
      contractType: "exotic-type" as unknown,
    } as RichContractExtractData
    await ingestExtractedContracts([{ extracted }])
    expect(contractCreates[0].contractType).toBe("usage")
  })

  it("sets isMultiFacility=true when >1 facility listed", async () => {
    const extracted: RichContractExtractData = {
      ...validExtracted,
      facilities: [
        { name: "Lighthouse", city: null, state: null },
        { name: "Harborview", city: null, state: null },
        { name: "Summit", city: null, state: null },
      ],
    }
    await ingestExtractedContracts([{ extracted }])
    expect(contractCreates[0].isMultiFacility).toBe(true)
  })

  it("defaults totalValue to 0 when tieInDetails is absent", async () => {
    const extracted: RichContractExtractData = {
      ...validExtracted,
      tieInDetails: null,
    }
    await ingestExtractedContracts([{ extracted }])
    expect(Number(contractCreates[0].totalValue)).toBe(0)
  })

  it("stores specialConditions joined as description", async () => {
    const extracted = {
      ...validExtracted,
      specialConditions: ["Price protection", "Net 60 terms", "MFN clause"],
    }
    await ingestExtractedContracts([{ extracted }])
    expect(contractCreates[0].description).toBe(
      "Price protection · Net 60 terms · MFN clause",
    )
  })

  it("sets description null when specialConditions is empty", async () => {
    const extracted = { ...validExtracted, specialConditions: [] }
    await ingestExtractedContracts([{ extracted }])
    expect(contractCreates[0].description).toBeNull()
  })
})

describe("ingestExtractedContracts — failure handling", () => {
  it("captures per-item errors without failing the batch", async () => {
    const { prisma } = await import("@/lib/db")
    const createMock = prisma.contract.create as ReturnType<typeof vi.fn>
    createMock.mockImplementationOnce(async () => {
      throw new Error("Duplicate key violation")
    })

    const result = await ingestExtractedContracts([
      { extracted: validExtracted, sourceFilename: "dup.pdf" },
      { extracted: validExtracted, sourceFilename: "second.pdf" },
    ])

    expect(result.created).toBe(1)
    expect(result.failed).toBe(1)
    expect(result.results[0]).toMatchObject({
      ok: false,
      error: expect.stringContaining("Duplicate key"),
    })
    expect(result.results[1]).toMatchObject({ ok: true })
  })

  it("truncates long error messages to 4000 chars", async () => {
    const { prisma } = await import("@/lib/db")
    const createMock = prisma.contract.create as ReturnType<typeof vi.fn>
    createMock.mockImplementationOnce(async () => {
      throw new Error("x".repeat(10000))
    })

    const result = await ingestExtractedContracts([
      { extracted: validExtracted },
    ])

    const err = result.results[0] as { ok: false; error: string }
    expect(err.ok).toBe(false)
    expect(err.error.length).toBeLessThanOrEqual(4000)
  })
})

describe("ingestExtractedContracts — empty input", () => {
  it("returns zero counts for empty items array", async () => {
    const result = await ingestExtractedContracts([])
    expect(result.created).toBe(0)
    expect(result.failed).toBe(0)
    expect(result.results).toEqual([])
  })
})
