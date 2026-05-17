/**
 * Spec 2026-05-17: volume rebate `% of Spend` on the CPT path +
 * regression guards for per-unit + COG-fallback.
 *
 * Mocks @/lib/db at the test boundary; we exercise
 * `recomputeVolumeAccrualForTerm` directly and assert on the
 * `prisma.rebate.createMany` payload.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type CaseRow = {
  id: string
  dateOfSurgery: Date
  procedures: Array<{ cptCode: string }>
}
type CogRow = {
  transactionDate: Date
  quantity: number
  extendedPrice: number | null
}

let caseRows: CaseRow[] = []
let cogRows: CogRow[] = []
const createManyCalls: Array<{
  data: Array<{ rebateEarned: number; payPeriodStart: Date; payPeriodEnd: Date; notes: string }>
}> = []

vi.mock("@/lib/db", () => ({
  prisma: {
    case: {
      findMany: vi.fn(async () => caseRows),
    },
    cOGRecord: {
      findMany: vi.fn(async ({ select }: { select: Record<string, boolean> }) => {
        // Honor the two selects we issue: { transactionDate, extendedPrice }
        // for the CPT-path percent_of_spend fetch, and
        // { transactionDate, quantity, extendedPrice } for the COG fallback.
        return cogRows.map((r) => {
          const out: Record<string, unknown> = {}
          if (select.transactionDate) out.transactionDate = r.transactionDate
          if (select.quantity) out.quantity = r.quantity
          if (select.extendedPrice) out.extendedPrice = r.extendedPrice
          return out
        })
      }),
    },
    rebate: {
      deleteMany: vi.fn(async () => ({ count: 0 })),
      createMany: vi.fn(async (args: { data: typeof createManyCalls[number]["data"] }) => {
        createManyCalls.push({ data: args.data })
        return { count: args.data.length }
      }),
    },
  },
}))

import { recomputeVolumeAccrualForTerm } from "@/lib/contracts/recompute/volume"

const FACILITY = "fac_test"
const CONTRACT = "ct_test"
const VENDOR = "vd_test"
// Use a window comfortably in the past so today (2026-05-17 per CLAUDE.md)
// is past the term end. Otherwise the writer clamps `end` to today and
// annual buckets fail to close.
const START = new Date(Date.UTC(2024, 0, 1)) // 2024-01-01
const END = new Date(Date.UTC(2024, 11, 31)) // 2024-12-31

function baseTerm(overrides: Partial<{
  cptCodes: string[]
  evaluationPeriod: string | null
  rebateMethod: string | null
  appliesTo: string | null
  categories: string[]
  tiers: Array<{
    tierNumber: number
    tierName: string | null
    spendMin: unknown
    spendMax: unknown
    volumeMin?: number | null
    volumeMax?: number | null
    rebateValue: unknown
    rebateType?: string | null
  }>
}>) {
  return {
    id: "term_test",
    cptCodes: overrides.cptCodes ?? [],
    vendorId: VENDOR,
    categories: overrides.categories ?? [],
    appliesTo: overrides.appliesTo ?? "all_products",
    rebateMethod: overrides.rebateMethod ?? "cumulative",
    evaluationPeriod: overrides.evaluationPeriod ?? "annual",
    effectiveStart: START,
    effectiveEnd: END,
    tiers: overrides.tiers ?? [],
  }
}

beforeEach(() => {
  caseRows = []
  cogRows = []
  createManyCalls.length = 0
})

describe("recomputeVolumeAccrualForTerm — CPT path + percent_of_spend", () => {
  it("pays bucketSpend × fraction (not occurrences × rate × 100)", async () => {
    const cptDay = new Date(Date.UTC(2024, 5, 15))
    caseRows = Array.from({ length: 10 }, (_, i) => ({
      id: `case_${i}`,
      dateOfSurgery: cptDay,
      procedures: [{ cptCode: "12345" }],
    }))
    cogRows = [
      {
        transactionDate: cptDay,
        quantity: 0,
        extendedPrice: 100_000,
      },
    ]
    const term = baseTerm({
      cptCodes: ["12345"],
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          volumeMin: 0,
          volumeMax: null,
          rebateValue: 0.02,
          rebateType: "percent_of_spend",
        },
      ],
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    const rows = createManyCalls[0].data
    expect(rows.length).toBe(1)
    expect(rows[0].rebateEarned).toBeCloseTo(2_000, 6)
    expect(rows[0].notes).toContain("spend=$100000.00")
  })

  it("per-unit tier regression: rebateEarned = occurrences × $/unit", async () => {
    const cptDay = new Date(Date.UTC(2024, 5, 15))
    caseRows = Array.from({ length: 10 }, (_, i) => ({
      id: `case_${i}`,
      dateOfSurgery: cptDay,
      procedures: [{ cptCode: "12345" }],
    }))
    const term = baseTerm({
      cptCodes: ["12345"],
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          volumeMin: 0,
          volumeMax: null,
          rebateValue: 5,
          rebateType: "fixed_rebate_per_unit",
        },
      ],
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    const rows = createManyCalls[0].data
    expect(rows[0].rebateEarned).toBeCloseTo(50, 6)
  })

  it("mixed tiers: hits the percent_of_spend tier and pays on spend, not occurrences", async () => {
    const cptDay = new Date(Date.UTC(2024, 5, 15))
    caseRows = Array.from({ length: 15 }, (_, i) => ({
      id: `case_${i}`,
      dateOfSurgery: cptDay,
      procedures: [{ cptCode: "12345" }],
    }))
    cogRows = [
      {
        transactionDate: cptDay,
        quantity: 0,
        extendedPrice: 50_000,
      },
    ]
    const term = baseTerm({
      cptCodes: ["12345"],
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          volumeMin: 0,
          volumeMax: 10,
          rebateValue: 5,
          rebateType: "fixed_rebate_per_unit",
        },
        {
          tierNumber: 2,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          volumeMin: 10,
          volumeMax: null,
          rebateValue: 0.02,
          rebateType: "percent_of_spend",
        },
      ],
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    const rows = createManyCalls[0].data
    expect(rows.length).toBe(1)
    expect(rows[0].rebateEarned).toBeCloseTo(1_000, 6)
    // Critical: NOT the broken 15 × 0.02 × 100 = 30 number.
    expect(rows[0].rebateEarned).not.toBeCloseTo(30, 6)
  })
})

describe("recomputeVolumeAccrualForTerm — COG fallback + all-products", () => {
  it("per-unit tier: rebateEarned = sum(quantity) × $/unit", async () => {
    const day = new Date(Date.UTC(2024, 5, 15))
    cogRows = [
      { transactionDate: day, quantity: 12, extendedPrice: 0 },
      { transactionDate: day, quantity: 8, extendedPrice: 0 },
    ]
    const term = baseTerm({
      cptCodes: [],
      appliesTo: "all_products",
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          volumeMin: 0,
          volumeMax: null,
          rebateValue: 5,
          rebateType: "fixed_rebate_per_unit",
        },
      ],
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    const rows = createManyCalls[0].data
    expect(rows[0].rebateEarned).toBeCloseTo(100, 6)
  })
})
