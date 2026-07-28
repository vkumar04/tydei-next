import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The admin stat rows must describe the whole tenant set, never the page.
 *
 * `adminGetVendors` / `adminGetFacilities` return ONE page (pageSize 20) and
 * the stat cards above each table used to reduce over exactly those rows, so
 * production read "20 Total Vendors" against 201 (Charles 2026-07-28).
 *
 * The 2026-07-27 pass converted only the FIRST card of each row, which is
 * worse than the original bug: "201 Total Vendors" sat beside a Sales Reps and
 * Total Contracts figure summed over 20 rows, and one true number makes its
 * false neighbours read as authoritative.
 *
 * So this pins both halves:
 *   1. every total is a server-side aggregate over the SAME `where` as the
 *      list, in one round trip per model — no per-row counts, no page sums;
 *   2. no card in either component is an expression over the page array.
 */

const vendorFindMany = vi.fn()
const vendorAggregate = vi.fn()
const vendorCount = vi.fn()
const vendorDivisionCount = vi.fn()
const contractCount = vi.fn()
const facilityFindMany = vi.fn()
const facilityGroupBy = vi.fn()
const facilityCount = vi.fn()
const memberCount = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    vendor: {
      findMany: (a: unknown) => vendorFindMany(a),
      aggregate: (a: unknown) => vendorAggregate(a),
      count: (a: unknown) => vendorCount(a),
    },
    vendorDivision: { count: (a: unknown) => vendorDivisionCount(a) },
    contract: { count: (a: unknown) => contractCount(a) },
    facility: {
      findMany: (a: unknown) => facilityFindMany(a),
      groupBy: (a: unknown) => facilityGroupBy(a),
      count: (a: unknown) => facilityCount(a),
    },
    member: { count: (a: unknown) => memberCount(a) },
  },
}))
vi.mock("@/lib/actions/auth", () => ({ requireAdmin: vi.fn().mockResolvedValue({}) }))
vi.mock("@/lib/audit", () => ({ logAudit: vi.fn() }))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

import { adminGetVendors } from "@/lib/actions/admin/vendors"
import { adminGetFacilities } from "@/lib/actions/admin/facilities"

/** One page of 20, mirroring the `take: 20` the action asks for. */
const PAGE_ROWS = 20
/** Page sums the cards must NOT show: 20×3 contracts, 20×2 divisions. */
const PAGE_CONTRACTS = PAGE_ROWS * 3
const PAGE_REPS = PAGE_ROWS * 2

/** Production-shaped totals: 201 vendors, only 2 of them onboarded. */
const SERVER = {
  vendors: 201,
  onboarded: 2,
  reps: 412,
  vendorContracts: 1284,
  facilities: 201,
  activeFacilities: 180,
  users: 640,
  facilityContracts: 977,
}

function vendorPage() {
  return Array.from({ length: PAGE_ROWS }, (_, i) => ({
    id: `v-${i}`,
    name: `Vendor ${String(i).padStart(3, "0")}`,
    code: null,
    organizationId: null,
    contactName: i % 2 === 0 ? "A Rep" : null,
    contactEmail: null,
    status: "active",
    tier: "standard",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    _count: { contracts: 3, divisions: 2 },
  }))
}

function facilityPage() {
  return Array.from({ length: PAGE_ROWS }, (_, i) => ({
    id: `f-${i}`,
    name: `Facility ${String(i).padStart(3, "0")}`,
    type: "hospital",
    organizationId: `org-${i}`,
    city: "Boston",
    state: "MA",
    beds: 100,
    status: "active",
    healthSystem: { name: "Lighthouse Health" },
    organization: { _count: { members: 2 } },
    _count: { contracts: 3 },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  }))
}

beforeEach(() => {
  vi.clearAllMocks()
  vendorFindMany.mockResolvedValue(vendorPage())
  vendorAggregate.mockResolvedValue({
    _count: { _all: SERVER.vendors, organizationId: SERVER.onboarded },
  })
  vendorDivisionCount.mockResolvedValue(SERVER.reps)
  contractCount.mockResolvedValue(SERVER.vendorContracts)
  facilityFindMany.mockResolvedValue(facilityPage())
  facilityGroupBy.mockResolvedValue([
    { status: "active", _count: SERVER.activeFacilities },
    { status: "inactive", _count: SERVER.facilities - SERVER.activeFacilities },
  ])
  memberCount.mockResolvedValue(SERVER.users)
})

describe("adminGetVendors — stat scope", () => {
  it("returns tenant-wide totals, never the page's sums", async () => {
    const res = await adminGetVendors({})

    expect(res.vendors).toHaveLength(PAGE_ROWS)
    expect(res.total).toBe(SERVER.vendors)
    expect(res.onboardedTotal).toBe(SERVER.onboarded)
    // These two are the cards yesterday's partial fix left behind.
    expect(res.repTotal, "Sales Reps was summed over the page").toBe(SERVER.reps)
    expect(res.repTotal).not.toBe(PAGE_REPS)
    expect(res.contractTotal, "Total Contracts was summed over the page").toBe(
      SERVER.vendorContracts,
    )
    expect(res.contractTotal).not.toBe(PAGE_CONTRACTS)
  })

  it("computes every total over the SAME filter as the list", async () => {
    await adminGetVendors({ search: "st", status: "active" })
    const where = vendorFindMany.mock.calls[0][0].where

    expect(where).toEqual({
      name: { contains: "st", mode: "insensitive" },
      status: "active",
    })
    expect(vendorAggregate.mock.calls[0][0].where).toEqual(where)
    // Reps and contracts hang off other models, so they are counted THROUGH
    // the same vendor filter rather than over an unfiltered table.
    expect(vendorDivisionCount.mock.calls[0][0].where).toEqual({ vendor: { is: where } })
    expect(contractCount.mock.calls[0][0].where).toEqual({ vendor: { is: where } })
  })

  it("never lets a total escape the filter and count the whole table", async () => {
    await adminGetVendors({ search: "st" })
    for (const spy of [vendorDivisionCount, contractCount]) {
      expect(spy.mock.calls[0][0].where).not.toEqual({})
      expect(spy.mock.calls[0][0]).toHaveProperty("where")
    }
  })

  it("uses one aggregate for both vendor-level cards", async () => {
    await adminGetVendors({})
    expect(vendorAggregate).toHaveBeenCalledTimes(1)
    // `_count` on a nullable column counts NON-NULL values, so "has an
    // Organization" rides along with the row count instead of a second query.
    expect(vendorAggregate.mock.calls[0][0]._count).toEqual({
      _all: true,
      organizationId: true,
    })
    expect(vendorCount, "a pile of count() calls where one aggregate does").not.toHaveBeenCalled()
  })

  it("counts reps and contracts once, not once per row", async () => {
    await adminGetVendors({})
    expect(vendorDivisionCount).toHaveBeenCalledTimes(1)
    expect(contractCount).toHaveBeenCalledTimes(1)
  })

  it("still routes through the vendor filter when nothing is filtered", async () => {
    // The unfiltered call leaves `where` empty, so these become
    // `{ vendor: { is: {} } }` — verified against the dev database to return
    // the same number as a bare count(). Collapsing them to `count()` "because
    // the filter is empty" is the regression this guards: it reads fine
    // unfiltered and silently counts the whole table the moment a search or a
    // status IS supplied.
    await adminGetVendors({})
    expect(vendorDivisionCount.mock.calls[0][0]).toEqual({ where: { vendor: { is: {} } } })
    expect(contractCount.mock.calls[0][0]).toEqual({ where: { vendor: { is: {} } } })
  })

  it("still pages the list itself", async () => {
    await adminGetVendors({ page: 3, pageSize: 20 })
    expect(vendorFindMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 })
    // …and the totals stay whole-set regardless of which page is asked for.
    expect(vendorAggregate.mock.calls[0][0]).not.toHaveProperty("take")
    expect(vendorAggregate.mock.calls[0][0]).not.toHaveProperty("skip")
  })
})

describe("adminGetFacilities — stat scope", () => {
  it("returns tenant-wide totals, never the page's sums", async () => {
    contractCount.mockResolvedValue(SERVER.facilityContracts)
    const res = await adminGetFacilities({})

    expect(res.facilities).toHaveLength(PAGE_ROWS)
    expect(res.total).toBe(SERVER.facilities)
    // All 20 rows on the page are "active"; the real split is 180/201.
    expect(res.activeTotal, "Active was filtered over the page").toBe(
      SERVER.activeFacilities,
    )
    expect(res.activeTotal).not.toBe(PAGE_ROWS)
    expect(res.userTotal, "Total Users was summed over the page").toBe(SERVER.users)
    expect(res.userTotal).not.toBe(PAGE_ROWS * 2)
    expect(res.contractTotal, "Total Contracts was summed over the page").toBe(
      SERVER.facilityContracts,
    )
    expect(res.contractTotal).not.toBe(PAGE_CONTRACTS)
  })

  it("gets the row count and the status split from one groupBy", async () => {
    await adminGetFacilities({})
    expect(facilityGroupBy).toHaveBeenCalledTimes(1)
    expect(facilityGroupBy.mock.calls[0][0]).toMatchObject({
      by: ["status"],
      _count: true,
    })
    expect(facilityCount, "groupBy already carries the total").not.toHaveBeenCalled()
  })

  it("reports 0 active rather than crashing when no facility matches", async () => {
    facilityFindMany.mockResolvedValue([])
    facilityGroupBy.mockResolvedValue([])
    memberCount.mockResolvedValue(0)
    contractCount.mockResolvedValue(0)
    const res = await adminGetFacilities({ search: "nothing-matches-this" })
    expect(res.total).toBe(0)
    expect(res.activeTotal).toBe(0)
  })

  it("computes every total over the SAME filter as the list", async () => {
    await adminGetFacilities({ search: "lighthouse" })
    const where = facilityFindMany.mock.calls[0][0].where

    expect(where).toEqual({ name: { contains: "lighthouse", mode: "insensitive" } })
    expect(facilityGroupBy.mock.calls[0][0].where).toEqual(where)
    expect(memberCount.mock.calls[0][0].where).toEqual({
      organization: { facility: { is: where, isNot: null } },
    })
    expect(contractCount.mock.calls[0][0].where).toEqual({
      facility: { is: where, isNot: null },
    })
  })

  it("keeps vendor-org members and orphaned contracts out of facility totals", async () => {
    // Organization.facility and Contract.facilityId are both nullable — a
    // vendor org's members, and contracts orphaned by a facility delete
    // (facilityId -> NULL), must not land under a facility label.
    //
    // Both guards are load-bearing on real data, not theoretical: the dev
    // database holds 20 contracts of which only 19 have a facility, and 9
    // members of which only 4 belong to a facility org. Drop either guard and
    // the card over-reports against the column beside it.
    await adminGetFacilities({})
    expect(memberCount.mock.calls[0][0].where.organization.facility.isNot).toBeNull()
    expect(contractCount.mock.calls[0][0].where.facility.isNot).toBeNull()
  })

  it("keeps the orphan guard on the unfiltered call too", async () => {
    // Empty `where` is the shape every real page load uses, and the one where
    // an orphan guard looks most redundant.
    await adminGetFacilities({})
    expect(contractCount.mock.calls[0][0]).toEqual({
      where: { facility: { is: {}, isNot: null } },
    })
    expect(memberCount.mock.calls[0][0]).toEqual({
      where: { organization: { facility: { is: {}, isNot: null } } },
    })
  })
})

// ─── The cards themselves ────────────────────────────────────────

const COMPONENTS = join(import.meta.dirname, "..", "..", "..", "..", "components", "admin")

/** Strip comments so a card's explanatory note can quote the old bad code. */
function sourceWithoutComments(file: string): string {
  return readFileSync(join(COMPONENTS, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
}

/** [value expression, label] for every stat card in a stat row. */
function statCards(src: string): [string, string][] {
  const re =
    /text-2xl font-bold">\{([^{}]+)\}<\/p>\s*<p className="text-xs text-muted-foreground">([^<]+)<\/p>/g
  return [...src.matchAll(re)].map((m) => [m[1].trim(), m[2].trim()])
}

describe.each([
  ["vendor-table.tsx", "vendors", ["Total Vendors", "Onboarded", "Sales Reps", "Total Contracts"]],
  ["facility-table.tsx", "facilities", ["Total Facilities", "Active", "Total Users", "Total Contracts"]],
] as const)("%s stat row", (file, rows, labels) => {
  const src = sourceWithoutComments(file)

  it("renders every card from a server-side total", () => {
    const cards = statCards(src)
    expect(cards.map(([, label]) => label)).toEqual([...labels])
    for (const [expr, label] of cards) {
      // `stat(data?.x)` and nothing else. Anything referencing the page array
      // is the bug: a label describing the tenant over a number describing 20
      // rows.
      expect(expr, `"${label}" is not a server-side total`).toMatch(
        /^stat\(data\?\.\w+\)$/,
      )
    }
  })

  it("derives no card from the returned page", () => {
    for (const method of ["reduce", "filter", "length"]) {
      expect(src, `${rows}.${method} is page-scoped`).not.toContain(`${rows}.${method}(`)
    }
    // `?? vendors.length` was the old fallback — a page count wearing a tenant
    // label the moment the server total is missing.
    expect(src).not.toContain(`?? ${rows}.length`)
  })

  it("says so where the table is still capped to one page", () => {
    // The list stays paginated; that is fine as long as the UI admits it.
    expect(src).toContain(`data.total > ${rows}.length`)
    expect(src).toMatch(/Showing the first/)
  })

  it("counts the cap against the server total, not against the page", () => {
    // "Showing the first 20 of 20" is the same lie in a smaller font. The
    // numerator is the page (that is the point) but the denominator has to be
    // the tenant-wide total, or the notice quietly agrees with the bug.
    const caption = src.match(/Showing the first[\s\S]*?<\/p>/)?.[0] ?? ""
    expect(caption, "no truncation caption found").not.toBe("")
    expect(caption).toContain("{data.total}")
    expect(caption, "the cap notice is measured against the page").not.toMatch(
      new RegExp(`of\\s*(\\{"\\s*"\\}\\s*)?\\{${rows}\\.length\\}`),
    )
  })

  it("shows a real zero instead of the loading dash", () => {
    // `??`, never `||`. A tenant with 0 onboarded vendors has a true answer;
    // rendering it as "—" hides a real number behind "still loading", which is
    // the same defect pointed the other way.
    expect(src).toContain(`const stat = (value: number | undefined) => value ?? "—"`)
  })
})
