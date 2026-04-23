import { describe, it, expect, vi } from "vitest"
import { recomputeMatchStatusesForVendor, loadContractsForVendor } from "../recompute"

type FakeRecord = {
  id: string
  facilityId: string
  vendorId: string | null
  vendorName: string | null
  vendorItemNo: string | null
  unitCost: number
  quantity: number
  transactionDate: Date
}

function makeDb(opts: {
  contracts?: Array<{
    id: string
    vendorId: string
    status: "active" | "expiring" | "expired"
    effectiveDate: Date
    expirationDate: Date | null
    facilityId: string
    contractFacilities: { facilityId: string }[]
    pricingItems: { vendorItemNo: string; unitPrice: number; listPrice: number | null }[]
  }>
  records?: FakeRecord[]
}) {
  const updates: Array<{ id: string; data: Record<string, unknown> }> = []
  const db = {
    contract: {
      findMany: vi.fn(async () => opts.contracts ?? []),
    },
    cOGRecord: {
      findMany: vi.fn(async () => opts.records ?? []),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        updates.push({ id: where.id, data })
        return { id: where.id }
      }),
    },
  }
  return { db, updates }
}

describe("loadContractsForVendor", () => {
  it("returns empty array when no contracts match", async () => {
    const { db } = makeDb({})
    // @ts-expect-error — fake DB shape
    const result = await loadContractsForVendor(db, "vendor-1", "fac-1")
    expect(result).toEqual([])
  })

  it("merges own-facility + contractFacilities into a de-duped list", async () => {
    const { db } = makeDb({
      contracts: [
        {
          id: "c-1",
          vendorId: "v-1",
          status: "active",
          effectiveDate: new Date("2026-01-01"),
          expirationDate: new Date("2026-12-31"),
          facilityId: "fac-1",
          contractFacilities: [{ facilityId: "fac-1" }, { facilityId: "fac-2" }],
          pricingItems: [{ vendorItemNo: "X", unitPrice: 10, listPrice: 20 }],
        },
      ],
    })
    // @ts-expect-error — fake DB shape
    const result = await loadContractsForVendor(db, "v-1", "fac-1")
    expect(result).toHaveLength(1)
    expect(result[0]!.facilityIds.sort()).toEqual(["fac-1", "fac-2"])
    expect(result[0]!.pricingItems[0]!.unitPrice).toBe(10)
  })
})

describe("recomputeMatchStatusesForVendor", () => {
  it("returns zero totals when vendor has no COG records", async () => {
    const { db } = makeDb({})
    // @ts-expect-error — fake DB shape
    const result = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-1",
      facilityId: "fac-1",
    })
    expect(result.total).toBe(0)
    expect(result.updated).toBe(0)
  })

  it("flips matching records to on_contract and updates enrichment columns", async () => {
    const { db, updates } = makeDb({
      contracts: [
        {
          id: "c-1",
          vendorId: "v-1",
          status: "active",
          effectiveDate: new Date("2026-01-01"),
          expirationDate: new Date("2026-12-31"),
          facilityId: "fac-1",
          contractFacilities: [],
          pricingItems: [{ vendorItemNo: "ITEM-A", unitPrice: 100, listPrice: 150 }],
        },
      ],
      records: [
        {
          id: "r-1",
          facilityId: "fac-1",
          vendorId: "v-1",
          vendorName: "Acme",
          vendorItemNo: "ITEM-A",
          unitCost: 100,
          quantity: 5,
          transactionDate: new Date("2026-06-15"),
        },
      ],
    })

    // @ts-expect-error — fake DB shape
    const summary = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-1",
      facilityId: "fac-1",
    })

    expect(summary.total).toBe(1)
    expect(summary.updated).toBe(1)
    expect(summary.onContract).toBe(1)

    expect(updates).toHaveLength(1)
    expect(updates[0]!.id).toBe("r-1")
    expect(updates[0]!.data).toMatchObject({
      matchStatus: "on_contract",
      contractId: "c-1",
      isOnContract: true,
    })
  })

  it("flips records to off_contract_item when vendor has no active contracts", async () => {
    const { db, updates } = makeDb({
      contracts: [],
      records: [
        {
          id: "r-1",
          facilityId: "fac-1",
          vendorId: "v-1",
          vendorName: "Acme",
          vendorItemNo: "ITEM-A",
          unitCost: 100,
          quantity: 5,
          transactionDate: new Date("2026-06-15"),
        },
      ],
    })

    // @ts-expect-error — fake DB shape
    const summary = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-1",
      facilityId: "fac-1",
    })

    expect(summary.offContract).toBe(1)
    expect(updates[0]!.data).toMatchObject({
      matchStatus: "off_contract_item",
      isOnContract: false,
      contractId: null,
    })
  })

  it("flips records to price_variance when actual exceeds contract by >2%", async () => {
    const { db, updates } = makeDb({
      contracts: [
        {
          id: "c-1",
          vendorId: "v-1",
          status: "active",
          effectiveDate: new Date("2026-01-01"),
          expirationDate: new Date("2026-12-31"),
          facilityId: "fac-1",
          contractFacilities: [],
          pricingItems: [{ vendorItemNo: "ITEM-A", unitPrice: 100, listPrice: 150 }],
        },
      ],
      records: [
        {
          id: "r-1",
          facilityId: "fac-1",
          vendorId: "v-1",
          vendorName: "Acme",
          vendorItemNo: "ITEM-A",
          unitCost: 115, // 15% overpay
          quantity: 10,
          transactionDate: new Date("2026-06-15"),
        },
      ],
    })

    // @ts-expect-error — fake DB shape
    const summary = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-1",
      facilityId: "fac-1",
    })

    expect(summary.priceVariance).toBe(1)
    expect(updates[0]!.data).toMatchObject({
      matchStatus: "price_variance",
      isOnContract: false,
    })
    // variancePercent should be 15
    expect(Number(updates[0]!.data.variancePercent)).toBeCloseTo(15, 2)
  })

  it("flips records to on_contract via the cascade vendor+date fallback when the contract has zero pricing rows (regression: Charles round-3 task 3)", async () => {
    // Regression: in seeded DBs, contracts may exist but ContractPricing
    // rows can be empty (pricing lives in PricingFile instead). Before the
    // cascade-override fix, every record here would flip to
    // off_contract_item because matchCOGRecordToContract couldn't find an
    // item-level match. The cascade's vendorAndDate step must still yield
    // on_contract linkage.
    const { db, updates } = makeDb({
      contracts: [
        {
          id: "c-empty-pricing",
          vendorId: "v-1",
          status: "active",
          effectiveDate: new Date("2026-01-01"),
          expirationDate: new Date("2026-12-31"),
          facilityId: "fac-1",
          contractFacilities: [],
          pricingItems: [], // ← empty ContractPricing
        },
      ],
      records: [
        {
          id: "r-1",
          facilityId: "fac-1",
          vendorId: "v-1",
          vendorName: "Acme",
          vendorItemNo: "ITEM-A",
          unitCost: 100,
          quantity: 5,
          transactionDate: new Date("2026-06-15"),
        },
      ],
    })

    // @ts-expect-error — fake DB shape
    const summary = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-1",
      facilityId: "fac-1",
    })

    expect(summary.onContract).toBe(1)
    expect(summary.offContract).toBe(0)
    expect(updates[0]!.data).toMatchObject({
      matchStatus: "on_contract",
      contractId: "c-empty-pricing",
      isOnContract: true,
      // No authoritative price without a ContractPricing row.
      contractPrice: null,
      savingsAmount: null,
    })
  })

  it("does NOT fire the cascade override when the contract has a priced catalog and the item isn't on it (oracle-parity fix)", async () => {
    // Regression from the 2026-04-23 oracle re-run: the cascade override
    // was firing for Arthrex POs whose vendorItemNo wasn't on the
    // contract's pricing sheet, inflating on_contract by 3,221 rows
    // (4,258 actual vs 1,037 oracle ground truth). The override should
    // ONLY fire when the contract has NO pricing catalog (the
    // zero-pricing-rows scenario above). When a catalog IS present and
    // the item simply isn't on it, that's genuinely off-contract.
    const { db, updates } = makeDb({
      contracts: [
        {
          id: "c-with-pricing",
          vendorId: "v-arthrex",
          status: "active",
          effectiveDate: new Date("2024-01-01"),
          expirationDate: new Date("2026-12-31"),
          facilityId: "fac-1",
          contractFacilities: [],
          pricingItems: [
            { vendorItemNo: "AR-CATALOGUED", unitPrice: 100, listPrice: 150 },
          ],
        },
      ],
      records: [
        {
          id: "r-off",
          facilityId: "fac-1",
          vendorId: "v-arthrex",
          vendorName: "Arthrex",
          vendorItemNo: "AR-NOT-ON-SHEET",
          unitCost: 50,
          quantity: 1,
          transactionDate: new Date("2025-06-15"),
        },
      ],
    })

    // @ts-expect-error — fake DB shape
    const summary = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-arthrex",
      facilityId: "fac-1",
    })

    expect(summary.onContract).toBe(0)
    expect(summary.offContract).toBe(1)
    expect(updates[0]!.data).toMatchObject({
      matchStatus: "off_contract_item",
      isOnContract: false,
    })
  })

  it("flips records to out_of_scope when contract dates don't cover transaction", async () => {
    const { db, updates } = makeDb({
      contracts: [
        {
          id: "c-1",
          vendorId: "v-1",
          status: "active",
          effectiveDate: new Date("2027-01-01"), // future
          expirationDate: new Date("2027-12-31"),
          facilityId: "fac-1",
          contractFacilities: [],
          pricingItems: [{ vendorItemNo: "ITEM-A", unitPrice: 100, listPrice: 150 }],
        },
      ],
      records: [
        {
          id: "r-1",
          facilityId: "fac-1",
          vendorId: "v-1",
          vendorName: "Acme",
          vendorItemNo: "ITEM-A",
          unitCost: 100,
          quantity: 5,
          transactionDate: new Date("2026-06-15"),
        },
      ],
    })

    // @ts-expect-error — fake DB shape
    const summary = await recomputeMatchStatusesForVendor(db, {
      vendorId: "v-1",
      facilityId: "fac-1",
    })

    expect(summary.outOfScope).toBe(1)
    expect(updates[0]!.data).toMatchObject({
      matchStatus: "out_of_scope",
      isOnContract: false,
    })
  })
})
