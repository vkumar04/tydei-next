import { describe, expect, it, vi, beforeEach } from "vitest"

/**
 * A Facility or Vendor created without an Organization is a dead tenant: it
 * can never have a single user, because `Member` links a user to an
 * Organization and nothing else.
 *
 * The 2026-07-26 audit found this had already happened at scale in
 * production — 1 of 2 facilities and 199 of 200 vendors had no organization.
 * Most of those vendors are catalog rows rather than tenants, which is fine;
 * the ones created through the admin UI were meant to be real and were dead
 * on arrival. Nothing surfaced it until someone tried to invite a user.
 */

const orgFindUnique = vi.fn()
const orgCreate = vi.fn()
const facilityCreate = vi.fn()
const vendorCreate = vi.fn()
const logAudit = vi.fn()

vi.mock("@/lib/actions/auth", () => ({
  requireAdmin: vi.fn().mockResolvedValue({ user: { id: "admin-1" } }),
}))
vi.mock("@/lib/db", () => {
  const tx = {
    organization: {
      findUnique: (d: unknown) => orgFindUnique(d),
      create: (d: unknown) => orgCreate(d),
    },
    facility: { create: (d: unknown) => facilityCreate(d) },
    vendor: { create: (d: unknown) => vendorCreate(d) },
  }
  return {
    prisma: {
      $transaction: (fn: (t: typeof tx) => unknown) => fn(tx),
      facility: { findMany: vi.fn(), count: vi.fn() },
      vendor: { findMany: vi.fn(), count: vi.fn() },
    },
  }
})
vi.mock("@/lib/audit", () => ({ logAudit: (...a: unknown[]) => logAudit(...a) }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { adminCreateFacility } from "@/lib/actions/admin/facilities"
import { adminCreateVendor } from "@/lib/actions/admin/vendors"

beforeEach(() => {
  vi.clearAllMocks()
  orgFindUnique.mockResolvedValue(null) // slug free
  orgCreate.mockImplementation(({ data }: { data: { name: string; slug: string } }) =>
    Promise.resolve({ id: `org-${data.slug}`, ...data }),
  )
  facilityCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "fac-1", ...data }),
  )
  vendorCreate.mockImplementation(({ data }: { data: Record<string, unknown> }) =>
    Promise.resolve({ id: "ven-1", ...data }),
  )
})

describe("adminCreateFacility", () => {
  it("provisions an Organization and links it", async () => {
    await adminCreateFacility({ name: "Summit General Hospital" } as never)
    expect(
      orgCreate,
      "no Organization means the facility can never have users",
    ).toHaveBeenCalledTimes(1)
    expect(facilityCreate.mock.calls[0][0].data.organizationId).toBe(
      "org-summit-general-hospital",
    )
  })

  it("derives a url-safe slug from the name", async () => {
    await adminCreateFacility({ name: "St. Mary's — Downtown #2" } as never)
    const slug = orgCreate.mock.calls[0][0].data.slug as string
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug.startsWith("-")).toBe(false)
    expect(slug.endsWith("-")).toBe(false)
  })

  it("disambiguates when the slug is taken", async () => {
    // Organization.slug is unique; a second "Summit General" must not collide.
    orgFindUnique.mockResolvedValueOnce({ id: "existing" }).mockResolvedValueOnce(null)
    await adminCreateFacility({ name: "Summit General" } as never)
    expect(orgCreate.mock.calls[0][0].data.slug).toBe("summit-general-2")
  })

  it("gives up rather than looping forever on pathological names", async () => {
    orgFindUnique.mockResolvedValue({ id: "always-taken" })
    await expect(
      adminCreateFacility({ name: "Taken" } as never),
    ).rejects.toThrow(/unique organization slug/i)
    expect(orgCreate).not.toHaveBeenCalled()
  })

  it("falls back to a usable slug when the name has no alphanumerics", async () => {
    await adminCreateFacility({ name: "###" } as never)
    expect(orgCreate.mock.calls[0][0].data.slug).toBe("org")
  })

  it("audits the creation", async () => {
    await adminCreateFacility({ name: "Audited" } as never)
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "facility.created" }),
    )
  })
})

describe("adminCreateVendor", () => {
  it("provisions an Organization and links it", async () => {
    await adminCreateVendor({ name: "Stryker" } as never)
    expect(orgCreate).toHaveBeenCalledTimes(1)
    expect(vendorCreate.mock.calls[0][0].data.organizationId).toBe("org-stryker")
  })

  it("audits the creation", async () => {
    await adminCreateVendor({ name: "Arthrex" } as never)
    expect(logAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "vendor.created" }),
    )
  })
})
