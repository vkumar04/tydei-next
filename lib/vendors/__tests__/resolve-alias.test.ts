/**
 * Charles 2026-07-27: "In settings on the vendor side, I have a company name,
 * example Stryker. How does it know on the facility side what contract to pull
 * in when multiple names are used?"
 *
 * Pass 1a (VendorAlias — the vendor's own declaration) and Pass 1b (normalized
 * key on the vendor's own name). Both are EXACT on the normalized key; fuzzy
 * matching stays behind them as a last resort.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"
import { vendorNameKey } from "@/lib/vendors/normalize"

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
    vendorNameMapping: { findMany: (a: unknown) => mappingFindMany(a) },
    vendorAlias: { findMany: (a: unknown) => aliasFindMany(a) },
  },
}))

const STRYKER = { id: "v-stryker", name: "Stryker", displayName: null }

function aliasRows(vendorId: string, names: string[]) {
  return names.map((n) => ({ normalizedAlias: vendorNameKey(n), vendorId }))
}

describe("resolveVendorId — Pass 1b, normalized-key on the vendor's own name", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorFindMany.mockResolvedValue([STRYKER])
    mappingFindMany.mockResolvedValue([])
    aliasFindMany.mockResolvedValue([])
  })

  it("resolves pure formatting drift with no alias declared", async () => {
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    for (const spelling of [
      "Stryker",
      "STRYKER CORPORATION",
      "Stryker, Inc.",
      "  stryker corp  ",
    ]) {
      expect(await resolveVendorId(spelling, { createMissing: false })).toBe(
        "v-stryker",
      )
    }
  })

  it("does not itself resolve an ambiguous normalized key", async () => {
    // Two vendors collide on the key, so Pass 1b must NOT pick one — over-
    // merging cross-attributes one company's spend to another's contract and
    // inflates rebate accrual, which is a financial error rather than a
    // reporting gap.
    //
    // It still falls through to the PRE-EXISTING 0.7 fuzzy pass, which does
    // guess here (any two names sharing a normalized key are also ~1.0 similar,
    // so no fixture can separate them). That is unchanged legacy behavior and
    // deliberately left alone; what this pins is that the new pass adds no NEW
    // deterministic wrong answer. Asserting equality with matchVendorByAlias is
    // exactly that claim.
    const vendors = [
      { id: "v-a", name: "Apex Medical Inc", displayName: null },
      { id: "v-b", name: "Apex Medical LLC", displayName: null },
    ]
    vendorFindMany.mockResolvedValue(vendors)
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    const { matchVendorByAlias } = await import("@/lib/vendor-aliases")

    const id = await resolveVendorId("Apex Medical", { createMissing: false })
    expect(id).toBe(matchVendorByAlias("Apex Medical", vendors))
  })

  it("never matches on an empty key", async () => {
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    // "Inc." normalizes to "" — it must not collapse onto any vendor.
    expect(await resolveVendorId("Inc.", { createMissing: false })).toBeNull()
  })
})

describe("resolveVendorId — Pass 1a, vendor-declared aliases", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vendorFindMany.mockResolvedValue([STRYKER])
    mappingFindMany.mockResolvedValue([])
    aliasFindMany.mockResolvedValue([])
  })

  it("resolves the spellings that used to mint duplicate vendors", async () => {
    // Verified against the live DB: these were 7 of the 11 spellings that
    // returned null pre-fix, each one silently creating its own Vendor row.
    const declared = [
      "Stryker Sales Corp",
      "Howmedica Osteonics",
      "MAKO Surgical Corp",
      "Stryker Flex Financial",
      "Stryker Endoscopy",
      "Stryker Instruments",
    ]
    aliasFindMany.mockResolvedValue(aliasRows("v-stryker", declared))
    const { resolveVendorId } = await import("@/lib/vendors/resolve")

    for (const spelling of [...declared, "STRYKER SALES CORP", "howmedica osteonics, inc."]) {
      expect(await resolveVendorId(spelling, { createMissing: false })).toBe(
        "v-stryker",
      )
    }
  })

  it("ignores an alias whose vendor no longer exists", async () => {
    // Same dangling-id guard as Pass 0 — a deleted vendor must not strand
    // resolution on an id that is no longer in the vendor list.
    //
    // The name must be one the LATER passes cannot rescue, or this asserts
    // nothing. It originally used "Howmedica Osteonics", which was then added to
    // the curated VENDOR_ALIASES list — so Pass 2 legitimately resolved it to
    // Stryker and this failed for the right reason. Use a name that is in
    // neither the curated list nor fuzzy range of any vendor.
    const ORPHAN = "Zenith Orthopedic Supply"
    aliasFindMany.mockResolvedValue(aliasRows("v-deleted", [ORPHAN]))
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    expect(await resolveVendorId(ORPHAN, { createMissing: false })).toBeNull()
  })

  it("lets a confirmed per-facility mapping still win over an alias", async () => {
    // Pass 0 is the facility's own explicit override and outranks everything.
    vendorFindMany.mockResolvedValue([
      STRYKER,
      { id: "v-other", name: "Other Ortho", displayName: null },
    ])
    aliasFindMany.mockResolvedValue(aliasRows("v-stryker", ["Howmedica Osteonics"]))
    mappingFindMany.mockResolvedValue([
      { cogVendorName: "Howmedica Osteonics", mappedVendorId: "v-other" },
    ])
    const { resolveVendorId } = await import("@/lib/vendors/resolve")
    expect(
      await resolveVendorId("Howmedica Osteonics", {
        facilityId: "f1",
        createMissing: false,
      }),
    ).toBe("v-other")
  })

  it("resolves aliases in the bulk path too", async () => {
    aliasFindMany.mockResolvedValue(aliasRows("v-stryker", ["Howmedica Osteonics"]))
    const { resolveVendorIdsBulk } = await import("@/lib/vendors/resolve")
    const map = await resolveVendorIdsBulk(
      ["Howmedica Osteonics", "Stryker Corp"],
      { createMissing: false },
    )
    expect(map.get("howmedica osteonics")).toBe("v-stryker")
    expect(map.get("stryker corp")).toBe("v-stryker")
  })
})
