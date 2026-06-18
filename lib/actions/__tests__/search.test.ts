import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * Global ⌘K search (`globalSearch`) regression guards.
 *
 * 1. Group-vendor drift: a vendor-scoped contract search must include
 *    grouped contracts where the vendor only appears in
 *    `additionalVendorIds` — i.e. it must route through
 *    `contractsOwnedByVendor`, never a bare `{ vendorId }`. (CLAUDE.md
 *    invariant: "Contract ownership (vendor) … NEVER bare vendorId".)
 * 2. Invoice deep-link: facility hits link to the invoice detail route
 *    `/dashboard/invoice-validation/{id}` (not the bare list), and vendor
 *    hits route to the vendor invoices surface.
 */

const {
  memberFindFirstMock,
  contractFindManyMock,
  vendorFindManyMock,
  alertFindManyMock,
  poFindManyMock,
  invoiceFindManyMock,
  reportFindManyMock,
  categoryFindManyMock,
  cogFindManyMock,
  requireAuthMock,
} = vi.hoisted(() => ({
  memberFindFirstMock: vi.fn(),
  contractFindManyMock: vi.fn(),
  vendorFindManyMock: vi.fn(),
  alertFindManyMock: vi.fn(),
  poFindManyMock: vi.fn(),
  invoiceFindManyMock: vi.fn(),
  reportFindManyMock: vi.fn(),
  categoryFindManyMock: vi.fn(),
  cogFindManyMock: vi.fn(),
  requireAuthMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    member: { findFirst: memberFindFirstMock },
    contract: { findMany: contractFindManyMock },
    vendor: { findMany: vendorFindManyMock },
    alert: { findMany: alertFindManyMock },
    purchaseOrder: { findMany: poFindManyMock },
    invoice: { findMany: invoiceFindManyMock },
    reportSchedule: { findMany: reportFindManyMock },
    productCategory: { findMany: categoryFindManyMock },
    cOGRecord: { findMany: cogFindManyMock },
  },
}))

vi.mock("@/lib/actions/auth", () => ({
  requireAuth: requireAuthMock,
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { globalSearch } from "@/lib/actions/search"

beforeEach(() => {
  vi.clearAllMocks()
  requireAuthMock.mockResolvedValue({ user: { id: "u-1" } })
  // Empty result sets by default; individual tests override what they assert on.
  for (const m of [
    contractFindManyMock,
    vendorFindManyMock,
    alertFindManyMock,
    poFindManyMock,
    invoiceFindManyMock,
    reportFindManyMock,
    categoryFindManyMock,
    cogFindManyMock,
  ]) {
    m.mockResolvedValue([])
  }
})

function asVendor(vendorId: string) {
  memberFindFirstMock.mockResolvedValue({
    organization: { facility: null, vendor: { id: vendorId } },
  })
}
function asFacility(facilityId: string) {
  memberFindFirstMock.mockResolvedValue({
    organization: { facility: { id: facilityId }, vendor: null },
  })
}

describe("globalSearch — contract ownership scope (group-vendor drift)", () => {
  it("vendor search includes grouped contracts via additionalVendorIds", async () => {
    asVendor("v-9")
    await globalSearch("knee")

    const where = contractFindManyMock.mock.calls[0][0].where
    // Ownership scope is AND-combined with the text-search OR.
    expect(Array.isArray(where.AND)).toBe(true)
    const ownership = where.AND[0]
    // Must carry BOTH branches — primary vendorId AND grouped membership.
    expect(ownership.OR).toContainEqual({ vendorId: "v-9" })
    expect(ownership.OR).toContainEqual({ additionalVendorIds: { has: "v-9" } })
    // The text search OR is the second AND clause, kept separate so the two
    // OR predicates don't collide.
    expect(where.AND[1].OR).toEqual([
      { name: { contains: "knee", mode: "insensitive" } },
      { contractNumber: { contains: "knee", mode: "insensitive" } },
      { description: { contains: "knee", mode: "insensitive" } },
    ])
  })

  it("never scopes a vendor by a bare { vendorId } (no additionalVendorIds branch)", async () => {
    asVendor("v-1")
    await globalSearch("hip")
    const where = contractFindManyMock.mock.calls[0][0].where
    // The bare-vendorId bug would put { vendorId } directly on `where` with no
    // grouped branch. Assert the grouped branch is always present.
    const ownership = where.AND[0]
    expect(ownership.OR).toContainEqual({ additionalVendorIds: { has: "v-1" } })
  })

  it("facility search scopes by facilityId", async () => {
    asFacility("fac-1")
    await globalSearch("stryker")
    const where = contractFindManyMock.mock.calls[0][0].where
    expect(where.AND[0]).toEqual({ facilityId: "fac-1" })
  })
})

describe("globalSearch — COG query fields", () => {
  it("searches real COGRecord fields, never a stale `sku`", async () => {
    asFacility("fac-1")
    await globalSearch("12345")
    const where = cogFindManyMock.mock.calls[0][0].where
    const orFields = where.OR.map((c: Record<string, unknown>) => Object.keys(c)[0])
    // The bad `sku` field threw `Unknown argument 'sku'` at runtime and
    // rejected the whole Promise.all → blanked every result group.
    expect(orFields).not.toContain("sku")
    expect(orFields).toEqual(
      expect.arrayContaining([
        "vendorItemNo",
        "inventoryDescription",
        "manufacturerNo",
        "inventoryNumber",
      ]),
    )
  })
})

describe("globalSearch — per-source resilience", () => {
  it("one failing source degrades to [] without rejecting the whole search", async () => {
    asFacility("fac-1")
    // Simulate the COG-style failure: one source throws.
    contractFindManyMock.mockRejectedValue(new Error("Unknown argument `sku`"))
    vendorFindManyMock.mockResolvedValue([
      { id: "v-1", name: "Stryker", displayName: null, division: null },
    ])

    // Must NOT throw — and other groups still populate.
    const res = await globalSearch("stryker")
    expect(res.contracts).toEqual([])
    expect(res.vendors).toHaveLength(1)
    expect(res.vendors[0].name).toBe("Stryker")
  })
})

describe("globalSearch — invoice deep-link", () => {
  beforeEach(() => {
    invoiceFindManyMock.mockResolvedValue([
      {
        id: "inv-7",
        invoiceNumber: "INV-7",
        status: "flagged",
        totalInvoiceCost: 100,
        vendor: { name: "Acme" },
      },
    ])
  })

  it("facility invoice links to the invoice detail route", async () => {
    asFacility("fac-1")
    const res = await globalSearch("INV-7")
    expect(res.invoices[0].href).toBe("/dashboard/invoice-validation/inv-7")
  })

  it("vendor invoice links to the vendor invoices surface", async () => {
    asVendor("v-1")
    const res = await globalSearch("INV-7")
    expect(res.invoices[0].href).toBe("/vendor/invoices")
  })
})
