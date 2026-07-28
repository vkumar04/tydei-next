import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * The user-creation Access picker must show EVERY tenant.
 *
 * Charles 2026-07-28: "adding vendor users not working... when you pick vendor
 * it does not let the vendors be accurate and it does not let you scroll the
 * vendor name list."
 *
 * The picker called `adminGetVendors({})`, which defaults to `pageSize: 20`, so
 * it received only the first 20 vendors ALPHABETICALLY. Production has 201
 * vendors, of which exactly two hold an Organization and can therefore have
 * users: "asfd" (alphabetical rank 19) and "Stryker" (rank 169). The picker
 * rendered 20 rows — 19 disabled "no organization yet" — and Stryker, the only
 * real target, was never in the list at all. Scrolling dead-ended at 20 because
 * 20 was all that had been fetched.
 *
 * Facilities were unaffected only because there are three of them, which is why
 * it presented as "vendor is broken, facility works". This pins the invariant
 * for BOTH so the facility side cannot regress the day a fourth is added.
 */

const vendorFindMany = vi.fn()
const facilityFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    vendor: { findMany: (a: unknown) => vendorFindMany(a) },
    facility: { findMany: (a: unknown) => facilityFindMany(a) },
  },
}))
vi.mock("@/lib/actions/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

/** 201 vendors, mirroring production: only ranks 19 and 169 are assignable. */
function prodShapedVendors() {
  return Array.from({ length: 201 }, (_, i) => ({
    id: `v-${i}`,
    name: `Vendor ${String(i).padStart(3, "0")}`,
    organizationId: i === 18 || i === 168 ? `org-${i}` : null,
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vendorFindMany.mockResolvedValue(prodShapedVendors())
  facilityFindMany.mockResolvedValue([
    { id: "f-1", name: "Lighthouse Surgical Center", organizationId: "org-a" },
  ])
})

describe("adminGetVendorOptions", () => {
  it("never paginates — no take or skip reaches Prisma", async () => {
    const { adminGetVendorOptions } = await import("@/lib/actions/admin/vendors")
    await adminGetVendorOptions()
    const arg = vendorFindMany.mock.calls[0]?.[0] ?? {}
    // This is the whole bug: `take: 20` here silently truncated the picker.
    expect(arg).not.toHaveProperty("take")
    expect(arg).not.toHaveProperty("skip")
  })

  it("returns the full catalog, not one page of it", async () => {
    const { adminGetVendorOptions } = await import("@/lib/actions/admin/vendors")
    const opts = await adminGetVendorOptions()
    expect(opts).toHaveLength(201)
    expect(opts.length).toBeGreaterThan(20)
  })

  it("includes an assignable vendor that sorts far past the old page boundary", async () => {
    // Rank 169 is the "Stryker" case — the one an admin actually needed and
    // could never reach.
    const { adminGetVendorOptions } = await import("@/lib/actions/admin/vendors")
    const opts = await adminGetVendorOptions()
    const assignable = opts.filter((o) => o.canHaveUsers)
    expect(assignable).toHaveLength(2)
    expect(opts.findIndex((o) => o.id === "v-168")).toBeGreaterThan(20)
    expect(assignable.map((o) => o.id)).toContain("v-168")
  })

  it("marks a tenant with no Organization as unable to hold users", async () => {
    const { adminGetVendorOptions } = await import("@/lib/actions/admin/vendors")
    const opts = await adminGetVendorOptions()
    expect(opts.find((o) => o.id === "v-0")?.canHaveUsers).toBe(false)
    expect(opts.find((o) => o.id === "v-168")?.canHaveUsers).toBe(true)
  })
})

describe("adminGetFacilityOptions", () => {
  it("never paginates either", async () => {
    const { adminGetFacilityOptions } = await import(
      "@/lib/actions/admin/facilities"
    )
    await adminGetFacilityOptions()
    const arg = facilityFindMany.mock.calls[0]?.[0] ?? {}
    expect(arg).not.toHaveProperty("take")
    expect(arg).not.toHaveProperty("skip")
  })
})
