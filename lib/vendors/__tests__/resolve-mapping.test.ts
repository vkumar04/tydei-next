/**
 * #1 (Vick 2026-05-31): the import resolver must apply a facility's
 * confirmed VendorNameMapping rules (Pass 0) so a mapped vendor name
 * resolves to its target on every future import — without a facility,
 * behavior is unchanged (back-compat).
 *
 * `matchVendorByAlias` runs for real; the fixture names are chosen so
 * they neither alias nor fuzzy-match, isolating the Pass 0 behavior.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const vendorFindMany = vi.fn()
const mappingFindMany = vi.fn()
const aliasFindMany = vi.fn()
const vendorCreate = vi.fn()
const vendorFindFirst = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    vendor: {
      findMany: (a: unknown) => vendorFindMany(a),
      create: (a: unknown) => vendorCreate(a),
      findFirst: (a: unknown) => vendorFindFirst(a),
    },
    vendorNameMapping: {
      findMany: (a: unknown) => mappingFindMany(a),
    },
    // Pass 1a (Charles 2026-07-27) — vendor-declared aliases. Empty by
    // default so these Pass 0 cases stay isolated; the alias pass has its
    // own coverage in resolve-alias.test.ts.
    vendorAlias: {
      findMany: (a: unknown) => aliasFindMany(a),
    },
  },
}))

const LEGACY = "Acme Legacy Co" // won't alias or fuzzy-match "NewCo"

describe("resolveVendorId — confirmed mapping Pass 0", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorFindMany.mockResolvedValue([
      { id: "v-new", name: "NewCo", displayName: null },
    ])
    mappingFindMany.mockResolvedValue([
      { cogVendorName: LEGACY, mappedVendorId: "v-new" },
    ])
    aliasFindMany.mockResolvedValue([])
  })

  it("resolves a mapped name to its target vendor, beating create", async () => {
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    const id = await resolveVendorId(LEGACY, {
      facilityId: "f1",
      createMissing: false,
    })
    expect(id).toBe("v-new")
    // Only confirmed, target-set rules for THIS facility are loaded.
    expect(mappingFindMany).toHaveBeenCalledWith({
      where: { facilityId: "f1", isConfirmed: true, mappedVendorId: { not: null } },
      select: { cogVendorName: true, mappedVendorId: true },
    })
  })

  it("skips Pass 0 entirely when no facilityId is given (back-compat)", async () => {
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    const id = await resolveVendorId(LEGACY, { createMissing: false })
    expect(id).toBeNull()
    expect(mappingFindMany).not.toHaveBeenCalled()
  })

  it("falls through when the mapping target vendor no longer exists", async () => {
    vendorFindMany.mockResolvedValueOnce([]) // target v-new is gone
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    const id = await resolveVendorId(LEGACY, {
      facilityId: "f1",
      createMissing: false,
    })
    expect(id).toBeNull()
  })
})

describe("resolveVendorIdsBulk — confirmed mapping Pass 0", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorFindMany.mockResolvedValue([
      { id: "v-new", name: "NewCo", displayName: null },
    ])
    mappingFindMany.mockResolvedValue([
      { cogVendorName: LEGACY, mappedVendorId: "v-new" },
    ])
    aliasFindMany.mockResolvedValue([])
  })

  it("maps the legacy name to the target in the result map", async () => {
    const { resolveVendorIdsBulk } = await import("@/lib/vendors/resolve")
    const map = await resolveVendorIdsBulk([LEGACY], {
      facilityId: "f1",
      createMissing: false,
    })
    expect(map.get(LEGACY.toLowerCase())).toBe("v-new")
  })

  it("does not consult mappings without a facilityId", async () => {
    const { resolveVendorIdsBulk } = await import("@/lib/vendors/resolve")
    const map = await resolveVendorIdsBulk([LEGACY], { createMissing: false })
    expect(map.size).toBe(0)
    expect(mappingFindMany).not.toHaveBeenCalled()
  })
})
