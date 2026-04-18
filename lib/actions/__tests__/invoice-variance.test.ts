/**
 * Tests for recomputeInvoiceVariance + recomputeAllInvoiceVariances —
 * the data-pipeline subsystem 1 server actions that bridge the pure
 * `computeInvoiceVariances` helper to Prisma.
 *
 * All external deps are mocked (prisma, requireFacility) so these
 * tests exercise the action's control flow, upsert keying, ownership
 * scope, and pass-through to the pure helper.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

type InvoiceRow = {
  id: string
  vendorId: string
  facilityId: string
  lineItems: Array<{
    id: string
    vendorItemNo: string | null
    invoicePrice: number
    invoiceQuantity: number
  }>
}

type PricingRow = {
  contractId: string
  vendorItemNo: string
  unitPrice: number
  vendorId: string
  status: "active" | "expired" | "pending"
}

type UpsertCall = {
  where: { invoiceLineItemId: string }
  create: Record<string, unknown>
  update: Record<string, unknown>
}

let invoiceByKey: Record<string, InvoiceRow | null> = {}
let pricingRows: PricingRow[] = []
let varianceStore: Record<string, Record<string, unknown>> = {}
let upsertCalls: UpsertCall[] = []

const invoiceFindUnique = vi.fn(
  async ({
    where,
  }: {
    where: { id: string; facilityId?: string }
  }) => {
    const row = invoiceByKey[where.id] ?? null
    if (!row) return null
    if (where.facilityId && row.facilityId !== where.facilityId) return null
    return row
  },
)

const invoiceFindMany = vi.fn(
  async ({ where }: { where: { facilityId: string } }) => {
    return Object.values(invoiceByKey)
      .filter((r): r is InvoiceRow => r !== null)
      .filter((r) => r.facilityId === where.facilityId)
      .map((r) => ({ id: r.id }))
  },
)

const contractPricingFindMany = vi.fn(
  async ({
    where,
  }: {
    where: {
      vendorItemNo: { in: string[] }
      contract: { vendorId: string; status: string }
    }
  }) => {
    return pricingRows
      .filter((p) => where.vendorItemNo.in.includes(p.vendorItemNo))
      .filter(
        (p) =>
          p.vendorId === where.contract.vendorId &&
          p.status === where.contract.status,
      )
      .map((p) => ({
        contractId: p.contractId,
        vendorItemNo: p.vendorItemNo,
        unitPrice: p.unitPrice,
      }))
  },
)

const varianceUpsert = vi.fn(async (args: UpsertCall) => {
  upsertCalls.push(args)
  const key = args.where.invoiceLineItemId
  if (varianceStore[key]) {
    varianceStore[key] = { ...varianceStore[key], ...args.update }
  } else {
    varianceStore[key] = { ...args.create }
  }
  return varianceStore[key]
})

vi.mock("@/lib/db", () => ({
  prisma: {
    invoice: {
      findUnique: (args: { where: { id: string; facilityId?: string } }) =>
        invoiceFindUnique(args),
      findMany: (args: { where: { facilityId: string } }) =>
        invoiceFindMany(args),
    },
    contractPricing: {
      findMany: (args: {
        where: {
          vendorItemNo: { in: string[] }
          contract: { vendorId: string; status: string }
        }
      }) => contractPricingFindMany(args),
    },
    invoicePriceVariance: {
      upsert: (args: UpsertCall) => varianceUpsert(args),
    },
  },
}))

const requireFacilityMock = vi.fn(async () => ({
  facility: { id: "fac-1" },
  user: { id: "user-1" },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: () => requireFacilityMock(),
}))

import {
  recomputeInvoiceVariance,
  recomputeAllInvoiceVariances,
} from "@/lib/actions/invoices/variance"

beforeEach(() => {
  vi.clearAllMocks()
  invoiceByKey = {}
  pricingRows = []
  varianceStore = {}
  upsertCalls = []
})

function seedInvoice(row: InvoiceRow): InvoiceRow {
  invoiceByKey[row.id] = row
  return row
}

describe("recomputeInvoiceVariance — happy path", () => {
  it("writes one variance row per matching line item with non-zero variance", async () => {
    seedInvoice({
      id: "inv-1",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        // overcharge — 105 vs 100 → +5% (moderate)
        {
          id: "li-1",
          vendorItemNo: "SKU-A",
          invoicePrice: 105,
          invoiceQuantity: 2,
        },
        // undercharge — 45 vs 50 → -10% (major)
        {
          id: "li-2",
          vendorItemNo: "SKU-B",
          invoicePrice: 45,
          invoiceQuantity: 4,
        },
        // moderate overcharge — 102 vs 100 → +2%
        {
          id: "li-3",
          vendorItemNo: "SKU-C",
          invoicePrice: 102,
          invoiceQuantity: 1,
        },
      ],
    })
    pricingRows = [
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-A",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-B",
        unitPrice: 50,
        vendorId: "vnd-1",
        status: "active",
      },
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-C",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
    ]

    const result = await recomputeInvoiceVariance("inv-1")

    expect(result.variancesWritten).toBe(3)
    expect(varianceUpsert).toHaveBeenCalledTimes(3)
    const byLine = Object.fromEntries(
      upsertCalls.map((c) => [c.where.invoiceLineItemId, c.create]),
    )
    expect(byLine["li-1"]?.direction).toBe("overcharge")
    expect(byLine["li-1"]?.severity).toBe("moderate")
    expect(byLine["li-1"]?.contractId).toBe("ct-1")
    expect(byLine["li-2"]?.direction).toBe("undercharge")
    expect(byLine["li-2"]?.severity).toBe("major")
    // (45 - 50) * 4 = -20
    expect(byLine["li-2"]?.dollarImpact).toBe(-20)
    expect(byLine["li-3"]?.severity).toBe("moderate")
  })
})

describe("recomputeInvoiceVariance — skip logic", () => {
  it("skips line items with no matching contract price", async () => {
    seedInvoice({
      id: "inv-2",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-a",
          vendorItemNo: "SKU-MATCH",
          invoicePrice: 120,
          invoiceQuantity: 1,
        },
        {
          id: "li-b",
          vendorItemNo: "SKU-UNKNOWN",
          invoicePrice: 77,
          invoiceQuantity: 1,
        },
      ],
    })
    pricingRows = [
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-MATCH",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
    ]

    const result = await recomputeInvoiceVariance("inv-2")

    expect(result.variancesWritten).toBe(1)
    expect(upsertCalls).toHaveLength(1)
    expect(upsertCalls[0]?.where.invoiceLineItemId).toBe("li-a")
  })

  it("skips line items with zero variance (exact contract match)", async () => {
    seedInvoice({
      id: "inv-3",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-exact",
          vendorItemNo: "SKU-X",
          invoicePrice: 100,
          invoiceQuantity: 3,
        },
        {
          id: "li-off",
          vendorItemNo: "SKU-Y",
          invoicePrice: 130,
          invoiceQuantity: 1,
        },
      ],
    })
    pricingRows = [
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-X",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-Y",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
    ]

    const result = await recomputeInvoiceVariance("inv-3")

    expect(result.variancesWritten).toBe(1)
    expect(upsertCalls[0]?.where.invoiceLineItemId).toBe("li-off")
  })

  it("returns zero when invoice has no line items with vendorItemNo", async () => {
    seedInvoice({
      id: "inv-empty",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-noitem",
          vendorItemNo: null,
          invoicePrice: 50,
          invoiceQuantity: 1,
        },
      ],
    })

    const result = await recomputeInvoiceVariance("inv-empty")

    expect(result.variancesWritten).toBe(0)
    expect(contractPricingFindMany).not.toHaveBeenCalled()
    expect(varianceUpsert).not.toHaveBeenCalled()
  })
})

describe("recomputeInvoiceVariance — idempotency", () => {
  it("upserts on invoiceLineItemId so re-runs don't duplicate rows", async () => {
    seedInvoice({
      id: "inv-re",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-1",
          vendorItemNo: "SKU-A",
          invoicePrice: 110,
          invoiceQuantity: 1,
        },
      ],
    })
    pricingRows = [
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-A",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
    ]

    const first = await recomputeInvoiceVariance("inv-re")
    const second = await recomputeInvoiceVariance("inv-re")

    expect(first.variancesWritten).toBe(1)
    expect(second.variancesWritten).toBe(1)
    // Both calls go through upsert — store only ever holds one entry
    expect(Object.keys(varianceStore)).toEqual(["li-1"])
    expect(varianceUpsert).toHaveBeenCalledTimes(2)
    // Every call scopes the unique key to invoiceLineItemId
    for (const call of upsertCalls) {
      expect(call.where).toEqual({ invoiceLineItemId: "li-1" })
    }
  })
})

describe("recomputeInvoiceVariance — ownership", () => {
  it("throws when invoice belongs to another facility", async () => {
    seedInvoice({
      id: "inv-foreign",
      facilityId: "fac-other",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-1",
          vendorItemNo: "SKU-A",
          invoicePrice: 100,
          invoiceQuantity: 1,
        },
      ],
    })

    await expect(recomputeInvoiceVariance("inv-foreign")).rejects.toThrow(
      /not found/i,
    )
    expect(varianceUpsert).not.toHaveBeenCalled()
  })

  it("throws when invoice id is unknown", async () => {
    await expect(recomputeInvoiceVariance("nope")).rejects.toThrow(/not found/i)
  })
})

describe("recomputeInvoiceVariance — contract scoping", () => {
  it("only considers active contracts for the invoice's vendor", async () => {
    seedInvoice({
      id: "inv-vendor",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-1",
          vendorItemNo: "SKU-A",
          invoicePrice: 110,
          invoiceQuantity: 1,
        },
      ],
    })
    // Pricing row exists but belongs to a *different* vendor — must be ignored.
    pricingRows = [
      {
        contractId: "ct-other",
        vendorItemNo: "SKU-A",
        unitPrice: 100,
        vendorId: "vnd-other",
        status: "active",
      },
    ]

    const result = await recomputeInvoiceVariance("inv-vendor")

    expect(result.variancesWritten).toBe(0)
    expect(contractPricingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          contract: { vendorId: "vnd-1", status: "active" },
        }),
      }),
    )
  })
})

describe("recomputeAllInvoiceVariances", () => {
  it("iterates every invoice at the facility and aggregates the counts", async () => {
    seedInvoice({
      id: "inv-A",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-A1",
          vendorItemNo: "SKU-A",
          invoicePrice: 110,
          invoiceQuantity: 1,
        },
      ],
    })
    seedInvoice({
      id: "inv-B",
      facilityId: "fac-1",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-B1",
          vendorItemNo: "SKU-A",
          invoicePrice: 120,
          invoiceQuantity: 1,
        },
        {
          id: "li-B2",
          vendorItemNo: "SKU-A",
          invoicePrice: 95,
          invoiceQuantity: 1,
        },
      ],
    })
    // Different facility — should be skipped entirely.
    seedInvoice({
      id: "inv-other",
      facilityId: "fac-other",
      vendorId: "vnd-1",
      lineItems: [
        {
          id: "li-other",
          vendorItemNo: "SKU-A",
          invoicePrice: 999,
          invoiceQuantity: 1,
        },
      ],
    })
    pricingRows = [
      {
        contractId: "ct-1",
        vendorItemNo: "SKU-A",
        unitPrice: 100,
        vendorId: "vnd-1",
        status: "active",
      },
    ]

    const result = await recomputeAllInvoiceVariances()

    expect(result.invoicesProcessed).toBe(2)
    expect(result.totalVariancesWritten).toBe(3)
    // Foreign invoice's line item should never show up.
    expect(Object.keys(varianceStore).sort()).toEqual([
      "li-A1",
      "li-B1",
      "li-B2",
    ])
  })
})
