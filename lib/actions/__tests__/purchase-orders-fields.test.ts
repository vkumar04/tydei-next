/**
 * PO field-persistence batch (2026-06-10).
 *
 * 1. createPurchaseOrder persists the procedure/patient/billing/GL header
 *    fields and per-line lotNumber/serialNumber that the create form
 *    collected but the action previously discarded.
 * 2. Empty optional fields normalize to null (not "" rows).
 * 3. getVendorPurchaseOrders (vendor read path) uses an explicit select
 *    that EXCLUDES the patient fields — vendors must never see
 *    patientMrn / patientInitials / procedureDate.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  contractCountMock,
  cogCountMock,
  poCountMock,
  poCreateMock,
  poFindManyMock,
  poAggregateMock,
  poGroupByMock,
  requireFacilityMock,
  requireVendorMock,
} = vi.hoisted(() => ({
  contractCountMock: vi.fn(),
  cogCountMock: vi.fn(),
  poCountMock: vi.fn(),
  poCreateMock: vi.fn(),
  poFindManyMock: vi.fn(),
  poAggregateMock: vi.fn(),
  poGroupByMock: vi.fn(),
  requireFacilityMock: vi.fn(),
  requireVendorMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    contract: { count: contractCountMock },
    cOGRecord: { count: cogCountMock },
    purchaseOrder: {
      count: poCountMock,
      create: poCreateMock,
      findMany: poFindManyMock,
      aggregate: poAggregateMock,
      groupBy: poGroupByMock,
    },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireFacility: requireFacilityMock,
  requireVendor: requireVendorMock,
}))

vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { createPurchaseOrder } from "@/lib/actions/purchase-orders"
import { getVendorPurchaseOrders } from "@/lib/actions/vendor-purchase-orders"

const PATIENT_FIELDS = ["patientMrn", "patientInitials", "procedureDate"] as const

beforeEach(() => {
  vi.clearAllMocks()
  requireFacilityMock.mockResolvedValue({ facility: { id: "fac-1" } })
  requireVendorMock.mockResolvedValue({ vendor: { id: "ven-1" } })
  contractCountMock.mockResolvedValue(1)
  cogCountMock.mockResolvedValue(0)
  poCountMock.mockResolvedValue(0)
  poCreateMock.mockImplementation(
    async (args: { data: Record<string, unknown> }) => ({
      id: "po-1",
      ...args.data,
      lineItems: [],
    }),
  )
})

describe("createPurchaseOrder — patient/billing/GL field persistence", () => {
  const baseInput = {
    facilityId: "fac-1",
    vendorId: "ven-1",
    orderDate: "2026-06-10",
    lineItems: [
      {
        inventoryDescription: "Hip implant",
        vendorItemNo: "HIP-100",
        quantity: 2,
        unitPrice: 1500,
      },
    ],
  }

  it("persists all collected header fields and per-line lot/serial", async () => {
    await createPurchaseOrder({
      ...baseInput,
      procedureDate: "2026-06-08",
      patientMrn: "MRN-998877",
      patientInitials: "JD",
      billToAddress: "Accounts Payable - 123 Medical Center Dr",
      paymentTerms: "NET30",
      departmentCode: "OR-2",
      glCode: "GL-5510",
      specialInstructions: "Deliver to dock B",
      notes: "Bill-only for 6/8 case",
      lineItems: [
        {
          ...baseInput.lineItems[0],
          lotNumber: "LOT-42",
          serialNumber: "SN-0099",
        },
      ],
    })

    expect(poCreateMock).toHaveBeenCalledOnce()
    const data = poCreateMock.mock.calls[0][0].data
    expect(data.procedureDate).toEqual(new Date("2026-06-08"))
    expect(data.patientMrn).toBe("MRN-998877")
    expect(data.patientInitials).toBe("JD")
    expect(data.billToAddress).toBe("Accounts Payable - 123 Medical Center Dr")
    expect(data.paymentTerms).toBe("NET30")
    expect(data.departmentCode).toBe("OR-2")
    expect(data.glCode).toBe("GL-5510")
    expect(data.specialInstructions).toBe("Deliver to dock B")
    expect(data.notes).toBe("Bill-only for 6/8 case")

    const line = data.lineItems.create[0]
    expect(line.lotNumber).toBe("LOT-42")
    expect(line.serialNumber).toBe("SN-0099")
  })

  it("normalizes omitted/empty optional fields to null", async () => {
    await createPurchaseOrder({
      ...baseInput,
      patientMrn: "  ", // whitespace-only → trimmed → null
    })

    const data = poCreateMock.mock.calls[0][0].data
    expect(data.procedureDate).toBeNull()
    expect(data.patientMrn).toBeNull()
    expect(data.patientInitials).toBeNull()
    expect(data.billToAddress).toBeNull()
    expect(data.paymentTerms).toBeNull()
    expect(data.departmentCode).toBeNull()
    expect(data.glCode).toBeNull()
    expect(data.specialInstructions).toBeNull()
    expect(data.notes).toBeNull()

    const line = data.lineItems.create[0]
    expect(line.lotNumber).toBeNull()
    expect(line.serialNumber).toBeNull()
  })

  it("rejects an unparseable procedureDate", async () => {
    await expect(
      createPurchaseOrder({ ...baseInput, procedureDate: "not-a-date" }),
    ).rejects.toThrow(/Invalid procedure date/i)
    expect(poCreateMock).not.toHaveBeenCalled()
  })
})

describe("getVendorPurchaseOrders — PHI exclusion", () => {
  // A full DB row as it now exists, INCLUDING patient fields. The mock
  // emulates Prisma `select` semantics: only selected keys come back, so
  // if the action ever regresses to include/full-row, the patient fields
  // leak into the result and the assertions below fail.
  const FULL_ROW: Record<string, unknown> = {
    id: "po-1",
    poNumber: "PO-00001",
    facilityId: "fac-1",
    vendorId: "ven-1",
    contractId: null,
    orderDate: new Date("2026-06-10"),
    totalCost: 3000,
    status: "sent",
    isOffContract: true,
    procedureDate: new Date("2026-06-08"),
    patientMrn: "MRN-998877",
    patientInitials: "JD",
    billToAddress: "Accounts Payable",
    paymentTerms: "NET30",
    departmentCode: "OR-2",
    glCode: "GL-5510",
    specialInstructions: "Deliver to dock B",
    notes: "Bill-only",
    createdAt: new Date("2026-06-10"),
    updatedAt: new Date("2026-06-10"),
    facility: { name: "Lighthouse Surgical Center" },
    _count: { lineItems: 1 },
  }

  beforeEach(() => {
    poFindManyMock.mockImplementation(
      async (args: { select?: Record<string, unknown> }) => {
        if (!args.select) return [FULL_ROW] // full-row regression path
        const row: Record<string, unknown> = {}
        for (const key of Object.keys(args.select)) {
          if (args.select[key]) row[key] = FULL_ROW[key]
        }
        return [row]
      },
    )
    poCountMock.mockResolvedValue(1)
    poAggregateMock.mockResolvedValue({ _sum: { totalCost: 3000 } })
    poGroupByMock.mockResolvedValue([{ status: "sent", _count: { _all: 1 } }])
  })

  it("queries with an explicit select that excludes patient fields", async () => {
    await getVendorPurchaseOrders()

    expect(poFindManyMock).toHaveBeenCalledOnce()
    const args = poFindManyMock.mock.calls[0][0]
    expect(args.select).toBeDefined()
    expect(args.include).toBeUndefined()
    for (const field of PATIENT_FIELDS) {
      expect(args.select).not.toHaveProperty(field)
    }
  })

  it("returned rows carry no patient fields", async () => {
    const result = await getVendorPurchaseOrders()

    expect(result.orders).toHaveLength(1)
    for (const order of result.orders) {
      for (const field of PATIENT_FIELDS) {
        expect(order).not.toHaveProperty(field)
      }
    }
    // sanity: the row still has the vendor-facing fields
    expect(result.orders[0].poNumber).toBe("PO-00001")
    expect(result.orders[0].facilityName).toBe("Lighthouse Surgical Center")
  })
})
