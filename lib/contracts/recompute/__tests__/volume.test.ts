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
  /** bugs.rtfd 2026-06-11 A5: vendor the COG row belongs to. Optional —
   * rows without it default to the primary test VENDOR so the pre-A5
   * tests keep their shape. The mock honors the query's `vendorId`
   * filter so vendor-scope regressions are actually exercised. */
  vendorId?: string
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
      findMany: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { vendorId?: string | { in: string[] } }
          select: Record<string, boolean>
        }) => {
          // bugs.rtfd 2026-06-11 A5: apply the vendor filter the writer
          // sends — `{ in: [...] }` (canonical group-aware shape) or a
          // bare string (legacy) — so the vendor-scope tests below fail
          // when the writer's scoping regresses.
          const vendorOk = (rowVendor: string): boolean => {
            const v = where.vendorId
            if (v === undefined) return true
            if (typeof v === "string") return v === rowVendor
            return v.in.includes(rowVendor)
          }
          // Honor the two selects we issue: { transactionDate, extendedPrice }
          // for the CPT-path percent_of_spend fetch, and
          // { transactionDate, quantity, extendedPrice } for the COG fallback.
          return cogRows
            .filter((r) => vendorOk(r.vendorId ?? VENDOR))
            .map((r) => {
              const out: Record<string, unknown> = {}
              if (select.transactionDate) out.transactionDate = r.transactionDate
              if (select.quantity) out.quantity = r.quantity
              if (select.extendedPrice) out.extendedPrice = r.extendedPrice
              return out
            })
        },
      ),
    },
    rebate: { findMany: vi.fn().mockResolvedValue([]), /* preserved-collected read (2026-07-29) */ 
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
  /** bugs.rtfd 2026-06-11 A5: explicit null exercises the vendor-less
   * term shape (`VolumeRebateTermLike.vendorId` is optional/nullable). */
  vendorId: string | null
  vendorIds: string[] | null
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
    vendorId: "vendorId" in overrides ? overrides.vendorId : VENDOR,
    vendorIds: overrides.vendorIds ?? null,
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

  it("marginal + percent_of_spend prorates bucket spend by per-tier occurrence slice", async () => {
    // 15 occurrences cross both tiers.
    // Tier 1: 0–10 occurrences, 1% of spend on that slice.
    // Tier 2: 10+,            2% of spend on that slice.
    // Bucket spend = $50,000 evenly across 15 occurrences (per-occ
    // share = $3,333.33).
    //
    // Expected payout:
    //   Tier 1 slice = 10 occ × $3,333.33 = $33,333.33 × 1% = $333.33
    //   Tier 2 slice =  5 occ × $3,333.33 = $16,666.67 × 2% = $333.33
    //   Total = $666.67
    //
    // Cumulative would be: top tier rate × whole spend = 2% × $50k = $1,000.
    // Make sure marginal does NOT collapse to that.
    const cptDay = new Date(Date.UTC(2024, 5, 15))
    caseRows = Array.from({ length: 15 }, (_, i) => ({
      id: `case_${i}`,
      dateOfSurgery: cptDay,
      procedures: [{ cptCode: "12345" }],
    }))
    cogRows = [
      { transactionDate: cptDay, quantity: 0, extendedPrice: 50_000 },
    ]
    const term = baseTerm({
      cptCodes: ["12345"],
      rebateMethod: "marginal",
      tiers: [
        {
          tierNumber: 1,
          tierName: null,
          spendMin: 0,
          spendMax: null,
          volumeMin: 0,
          volumeMax: 10,
          rebateValue: 0.01,
          rebateType: "percent_of_spend",
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
    // $333.33 + $333.33 = $666.67 (small float drift OK)
    expect(rows[0].rebateEarned).toBeCloseTo(666.67, 1)
    // Not the cumulative shortcut.
    expect(rows[0].rebateEarned).not.toBeCloseTo(1000, 1)
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
  it("counts qty across all in-scope COG records when volumeType=all_products + cptCodes empty", async () => {
    // Bug 2: form's `All products on contract` picker sets
    // volumeType=all_products, appliesTo=all_products, cptCodes=[]. The
    // recompute gate is empty cptCodes -> COG fallback; this test locks
    // in that path summing quantity = 20 at $5/unit = $100.
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

describe("volume COG fallback — vendor scope (bugs.rtfd 2026-06-11 A5)", () => {
  const ADDITIONAL_VENDOR = "vd_additional"
  // Charles's repro ladder: $5 / $9 / $11 per unit, thresholds in
  // volumeMin (the Int columns volume tiers actually use).
  const perUnitLadder = [
    {
      tierNumber: 1,
      tierName: null,
      spendMin: 0,
      spendMax: null,
      volumeMin: 0,
      volumeMax: 1000,
      rebateValue: 5,
      rebateType: "fixed_rebate_per_unit",
    },
    {
      tierNumber: 2,
      tierName: null,
      spendMin: 0,
      spendMax: null,
      volumeMin: 1000,
      volumeMax: 2000,
      rebateValue: 9,
      rebateType: "fixed_rebate_per_unit",
    },
    {
      tierNumber: 3,
      tierName: null,
      spendMin: 0,
      spendMax: null,
      volumeMin: 2000,
      volumeMax: null,
      rebateValue: 11,
      rebateType: "fixed_rebate_per_unit",
    },
  ]

  it("control: single-vendor contract accrues units × per-unit rate", async () => {
    const day = new Date(Date.UTC(2024, 5, 15))
    cogRows = [
      { transactionDate: day, quantity: 12, extendedPrice: 0, vendorId: VENDOR },
      { transactionDate: day, quantity: 8, extendedPrice: 0, vendorId: VENDOR },
    ]
    const term = baseTerm({ cptCodes: [], tiers: perUnitLadder })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    // 20 units → tier 1 (< 1000) @ $5/unit = $100.
    expect(createManyCalls[0].data[0].rebateEarned).toBeCloseTo(100, 6)
  })

  it("grouped contract (dispatcher shape): COG rows under an additionalVendorId accrue", async () => {
    const day = new Date(Date.UTC(2024, 5, 15))
    cogRows = [
      {
        transactionDate: day,
        quantity: 20,
        extendedPrice: 0,
        vendorId: ADDITIONAL_VENDOR,
      },
    ]
    // recompute-accrual.ts passes vendorId = contract.vendorId AND
    // vendorIds = contractVendorIds(contract) — group set includes the
    // additional vendor.
    const term = baseTerm({
      cptCodes: [],
      vendorId: VENDOR,
      vendorIds: [VENDOR, ADDITIONAL_VENDOR],
      tiers: perUnitLadder,
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    expect(createManyCalls[0].data[0].rebateEarned).toBeCloseTo(100, 6)
  })

  it("vendor set ONLY from vendorIds (no primary vendorId) still accrues", async () => {
    // bugs.rtfd 2026-06-11 A5 repro: the COG fallback used to early-return
    // on `!term.vendorId` even when the group vendor set was non-empty —
    // 0 COG rows → no [auto-volume-accrual] rows → timeline overlay $0.
    const day = new Date(Date.UTC(2024, 5, 15))
    cogRows = [
      {
        transactionDate: day,
        quantity: 20,
        extendedPrice: 0,
        vendorId: ADDITIONAL_VENDOR,
      },
    ]
    const term = baseTerm({
      cptCodes: [],
      vendorId: null,
      vendorIds: [ADDITIONAL_VENDOR],
      tiers: perUnitLadder,
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    expect(createManyCalls[0].data[0].rebateEarned).toBeCloseTo(100, 6)
  })

  it("truly vendor-less term (no vendorId, no vendorIds) stays a noop", async () => {
    const day = new Date(Date.UTC(2024, 5, 15))
    cogRows = [{ transactionDate: day, quantity: 20, extendedPrice: 0 }]
    const term = baseTerm({
      cptCodes: [],
      vendorId: null,
      vendorIds: null,
      tiers: perUnitLadder,
    })
    const r = await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(createManyCalls.length).toBe(0)
  })

  it("tier selected by cumulative units: 802 units → tier 1 @ $5.00 → $4,010", async () => {
    // Charles's exact month-1 number from bugs.rtfd 2026-06-11 A5.
    const day = new Date(Date.UTC(2024, 5, 15))
    cogRows = [
      { transactionDate: day, quantity: 802, extendedPrice: 0, vendorId: VENDOR },
    ]
    const term = baseTerm({
      cptCodes: [],
      evaluationPeriod: "monthly",
      tiers: perUnitLadder,
    })
    await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: START,
      contractExpirationDate: END,
      term,
    })
    expect(createManyCalls.length).toBe(1)
    const june = createManyCalls[0].data.find((r) =>
      r.payPeriodStart.toISOString().startsWith("2024-06"),
    )
    expect(june).toBeDefined()
    // 802 units sit in tier 1 (0–1000) → 802 × $5.00 = $4,010 — NOT the
    // top tier's $11/unit the timeline's display walk shows.
    expect(june!.rebateEarned).toBeCloseTo(4_010, 6)
    expect(june!.notes).toContain("802 units")
  })

  it("PINS DESIGN (W1.W-B1): an in-progress annual period writes NO rows yet", async () => {
    // Trace artifact for the A5 report: with an annual evaluation period
    // whose first window has not closed (term started < 12 months ago),
    // the writer emits zero rows BY DESIGN — incomplete windows are
    // dropped so the "earned ≤ today" ledger filter stays honest (same
    // rule as the spend writer, recompute-accrual.ts W1.W-B1). The
    // timeline then shows per-month units with Accrued $0 until the
    // period closes, because volume accrual comes from the persisted
    // overlay rows only.
    const now = new Date()
    const start = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 8, 1),
    )
    const end = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 16, 1),
    )
    const purchaseDay = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 15),
    )
    cogRows = [
      {
        transactionDate: purchaseDay,
        quantity: 802,
        extendedPrice: 0,
        vendorId: VENDOR,
      },
    ]
    const term = {
      ...baseTerm({ cptCodes: [], tiers: perUnitLadder }),
      effectiveStart: start,
      effectiveEnd: end,
      evaluationPeriod: "annual",
    }
    const r = await recomputeVolumeAccrualForTerm({
      contractId: CONTRACT,
      facilityId: FACILITY,
      contractEffectiveDate: start,
      contractExpirationDate: end,
      term,
    })
    expect(r).toEqual({ inserted: 0, sumEarned: 0 })
    expect(createManyCalls.length).toBe(0)
  })
})
