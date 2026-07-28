import { describe, expect, it, vi, beforeEach } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The admin stat rows must describe the whole tenant catalog — never the page,
 * and never the search box.
 *
 * Three passes at the same defect, each moving the scope one level closer
 * without arriving:
 *
 *   original    the cards reduced over the returned rows, so production read
 *               "20 Total Vendors" against 200 (Charles 2026-07-28).
 *   2026-07-27  only the FIRST card of each row was converted, which is worse
 *               than the original bug: a true "200 Total Vendors" sat beside a
 *               Sales Reps and Total Contracts figure still summed over 20, and
 *               one true number makes its false neighbours read as
 *               authoritative.
 *   2026-07-28  all four moved to the server but were computed over `where`,
 *               i.e. INSIDE the search. Typing "stryker" rewrote the row to
 *               "1 / 1 / 0 / 1" under four unqualified "Total …" labels, so
 *               nothing on the screen still answered "how many vendors are
 *               there".
 *
 * So this pins all three halves:
 *   1. every stat is a server-side aggregate over `baseWhere` — the console's
 *      whole scope — in one round trip per model; no per-row counts, no page
 *      sums, and no narrowing to the search;
 *   2. `total` (and only `total`) follows the search, because it is the
 *      denominator of the page range;
 *   3. no card in either component is an expression over the page array.
 */

const vendorFindMany = vi.fn()
const vendorGroupBy = vi.fn()
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
      groupBy: (a: unknown) => vendorGroupBy(a),
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

/**
 * Production-shaped totals. Production is 200 vendors / 2 facilities with
 * everything "active"; the inactive buckets below are deliberately non-empty so
 * "catalog" and "active" cannot pass by coincidence the way they do on the real
 * snapshot.
 */
const SERVER = {
  activeVendors: 199,
  /** Active AND organization-backed — what the Status column badges "Onboarded". */
  activeOnboarded: 2,
  inactiveVendors: 2,
  /** A deactivated vendor that still HAS an org: must not reach the card. */
  inactiveOnboarded: 1,
  reps: 412,
  vendorContracts: 1284,
  activeFacilities: 180,
  inactiveFacilities: 21,
  users: 640,
  facilityContracts: 977,
}
const VENDOR_CATALOG = SERVER.activeVendors + SERVER.inactiveVendors
const FACILITY_CATALOG = SERVER.activeFacilities + SERVER.inactiveFacilities
/** What a search narrows to — one row, against a 201-row catalog. */
const SEARCH_MATCHES = 1

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
  vendorGroupBy.mockResolvedValue([
    {
      status: "active",
      _count: { _all: SERVER.activeVendors, organizationId: SERVER.activeOnboarded },
    },
    {
      status: "inactive",
      _count: {
        _all: SERVER.inactiveVendors,
        organizationId: SERVER.inactiveOnboarded,
      },
    },
  ])
  vendorCount.mockResolvedValue(SEARCH_MATCHES)
  vendorDivisionCount.mockResolvedValue(SERVER.reps)
  contractCount.mockResolvedValue(SERVER.vendorContracts)
  facilityFindMany.mockResolvedValue(facilityPage())
  facilityGroupBy.mockResolvedValue([
    { status: "active", _count: SERVER.activeFacilities },
    { status: "inactive", _count: SERVER.inactiveFacilities },
  ])
  facilityCount.mockResolvedValue(SEARCH_MATCHES)
  memberCount.mockResolvedValue(SERVER.users)
})

describe("adminGetVendors — stat scope", () => {
  it("returns tenant-wide totals, never the page's sums", async () => {
    const res = await adminGetVendors({})

    expect(res.vendors).toHaveLength(PAGE_ROWS)
    expect(res.catalogTotal).toBe(VENDOR_CATALOG)
    expect(res.total).toBe(VENDOR_CATALOG)
    // These two are the cards the 2026-07-27 partial fix left behind.
    expect(res.repTotal, "Sales Reps was summed over the page").toBe(SERVER.reps)
    expect(res.repTotal).not.toBe(PAGE_REPS)
    expect(res.contractTotal, "Total Contracts was summed over the page").toBe(
      SERVER.vendorContracts,
    )
    expect(res.contractTotal).not.toBe(PAGE_CONTRACTS)
  })

  it("counts as Onboarded exactly what the Status column badges Onboarded", async () => {
    // vendor-columns.tsx renders "Inactive" ahead of "Onboarded", so a
    // deactivated vendor that still holds an Organization is NOT an onboarded
    // row on screen. Counting it here would put one word over two different
    // sets on the same page.
    const res = await adminGetVendors({})
    expect(res.onboardedTotal).toBe(SERVER.activeOnboarded)
    expect(res.onboardedTotal).not.toBe(
      SERVER.activeOnboarded + SERVER.inactiveOnboarded,
    )
  })

  it("keeps every card out of the search, and only the page range in it", async () => {
    // The 2026-07-28 regression: all four stats were computed over `where`, so
    // typing a vendor name turned "Total Vendors" into "how many matched".
    const res = await adminGetVendors({ search: "stryker" })

    expect(res.total, "the page range's denominator follows the search").toBe(
      SEARCH_MATCHES,
    )
    expect(res.catalogTotal, "“Total Vendors” must not follow the search").toBe(
      VENDOR_CATALOG,
    )
    expect(res.onboardedTotal).toBe(SERVER.activeOnboarded)
    expect(res.repTotal).toBe(SERVER.reps)
    expect(res.contractTotal).toBe(SERVER.vendorContracts)
    for (const stat of [res.catalogTotal, res.repTotal, res.contractTotal]) {
      expect(stat).not.toBe(SEARCH_MATCHES)
    }
  })

  it("aims each query at the scope its number claims", async () => {
    await adminGetVendors({ search: "st", status: "active" })
    const listWhere = vendorFindMany.mock.calls[0][0].where
    const scopeWhere = { status: "active" }

    // The LIST is the search; the STATS are the console scope the search runs
    // inside. Fold the two together and every card silently becomes the search.
    expect(listWhere).toEqual({
      name: { contains: "st", mode: "insensitive" },
      status: "active",
    })
    expect(vendorGroupBy.mock.calls[0][0].where).toEqual(scopeWhere)
    expect(vendorCount.mock.calls[0][0].where).toEqual(listWhere)
    // Reps and contracts hang off other models, so they are counted THROUGH
    // the same vendor scope rather than over an unfiltered table.
    expect(vendorDivisionCount.mock.calls[0][0].where).toEqual({
      vendor: { is: scopeWhere },
    })
    expect(contractCount.mock.calls[0][0].where).toEqual({
      vendor: { is: scopeWhere },
    })
  })

  it("never lets a total escape the status filter and count the whole table", async () => {
    await adminGetVendors({ status: "active" })
    for (const spy of [vendorDivisionCount, contractCount]) {
      expect(spy.mock.calls[0][0].where).not.toEqual({})
      expect(spy.mock.calls[0][0]).toHaveProperty("where")
    }
    expect(vendorGroupBy.mock.calls[0][0].where).toEqual({ status: "active" })
  })

  it("uses one groupBy for both vendor-level cards", async () => {
    await adminGetVendors({})
    expect(vendorGroupBy).toHaveBeenCalledTimes(1)
    // `_count` on a nullable column counts NON-NULL values, so "has an
    // Organization" rides along with the row count instead of a second query,
    // and splitting by status is what makes it mean "onboarded" rather than
    // "onboarded or once was".
    expect(vendorGroupBy.mock.calls[0][0]).toMatchObject({
      by: ["status"],
      _count: { _all: true, organizationId: true },
    })
    expect(
      vendorCount,
      "an unsearched page needs no second count",
    ).not.toHaveBeenCalled()
  })

  it("spends its one extra round trip on the search, not on the stats", async () => {
    await adminGetVendors({ search: "stryker" })
    expect(vendorGroupBy).toHaveBeenCalledTimes(1)
    expect(vendorCount).toHaveBeenCalledTimes(1)
    expect(vendorDivisionCount).toHaveBeenCalledTimes(1)
    expect(contractCount).toHaveBeenCalledTimes(1)
  })

  it("counts reps and contracts once, not once per row", async () => {
    await adminGetVendors({})
    expect(vendorDivisionCount).toHaveBeenCalledTimes(1)
    expect(contractCount).toHaveBeenCalledTimes(1)
  })

  it("still routes through the vendor filter when nothing is filtered", async () => {
    // The unfiltered call leaves the scope empty, so these become
    // `{ vendor: { is: {} } }` — verified against the dev database to return
    // the same number as a bare count(). Collapsing them to `count()` "because
    // the filter is empty" is the regression this guards: it reads fine
    // unfiltered and silently counts the whole table the moment a status IS
    // supplied.
    await adminGetVendors({})
    expect(vendorDivisionCount.mock.calls[0][0]).toEqual({ where: { vendor: { is: {} } } })
    expect(contractCount.mock.calls[0][0]).toEqual({ where: { vendor: { is: {} } } })
  })

  it("reports zeros rather than crashing when the catalog is empty", async () => {
    vendorFindMany.mockResolvedValue([])
    vendorGroupBy.mockResolvedValue([])
    vendorDivisionCount.mockResolvedValue(0)
    contractCount.mockResolvedValue(0)
    const res = await adminGetVendors({})
    expect(res.catalogTotal).toBe(0)
    expect(res.total).toBe(0)
    expect(res.onboardedTotal).toBe(0)
    expect(res.pageCount).toBe(1)
  })

  it("still pages the list itself", async () => {
    await adminGetVendors({ page: 3, pageSize: 20 })
    expect(vendorFindMany.mock.calls[0][0]).toMatchObject({ skip: 40, take: 20 })
    // …and the totals stay whole-set regardless of which page is asked for.
    expect(vendorGroupBy.mock.calls[0][0]).not.toHaveProperty("take")
    expect(vendorGroupBy.mock.calls[0][0]).not.toHaveProperty("skip")
  })

  it("clamps a page past the end instead of stranding the operator", async () => {
    // 201 vendors at 20/page is 11 pages; asking for 40 must serve page 11,
    // and the response has to SAY 11 or the pager keeps pointing past the end.
    const res = await adminGetVendors({ page: 40 })
    expect(res.pageCount).toBe(Math.ceil(VENDOR_CATALOG / 20))
    expect(res.page).toBe(res.pageCount)
    expect(vendorFindMany.mock.calls[0][0].skip).toBe((res.pageCount - 1) * 20)
  })
})

describe("adminGetFacilities — stat scope", () => {
  it("returns tenant-wide totals, never the page's sums", async () => {
    contractCount.mockResolvedValue(SERVER.facilityContracts)
    const res = await adminGetFacilities({})

    expect(res.facilities).toHaveLength(PAGE_ROWS)
    expect(res.catalogTotal).toBe(FACILITY_CATALOG)
    expect(res.total).toBe(FACILITY_CATALOG)
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

  it("keeps every card out of the search, and only the page range in it", async () => {
    contractCount.mockResolvedValue(SERVER.facilityContracts)
    const res = await adminGetFacilities({ search: "lighthouse" })

    expect(res.total).toBe(SEARCH_MATCHES)
    expect(res.catalogTotal, "“Total Facilities” must not follow the search").toBe(
      FACILITY_CATALOG,
    )
    expect(res.activeTotal).toBe(SERVER.activeFacilities)
    expect(res.userTotal).toBe(SERVER.users)
    expect(res.contractTotal).toBe(SERVER.facilityContracts)
  })

  it("gets the catalog count and the status split from one groupBy", async () => {
    await adminGetFacilities({})
    expect(facilityGroupBy).toHaveBeenCalledTimes(1)
    expect(facilityGroupBy.mock.calls[0][0]).toMatchObject({
      by: ["status"],
      _count: true,
    })
    expect(
      facilityCount,
      "groupBy already carries the catalog total",
    ).not.toHaveBeenCalled()
  })

  it("reports 0 active rather than crashing when no facility matches", async () => {
    facilityFindMany.mockResolvedValue([])
    facilityGroupBy.mockResolvedValue([])
    facilityCount.mockResolvedValue(0)
    memberCount.mockResolvedValue(0)
    contractCount.mockResolvedValue(0)
    const res = await adminGetFacilities({ search: "nothing-matches-this" })
    expect(res.total).toBe(0)
    expect(res.catalogTotal).toBe(0)
    expect(res.activeTotal).toBe(0)
  })

  it("aims each query at the scope its number claims", async () => {
    await adminGetFacilities({ search: "lighthouse" })
    const listWhere = facilityFindMany.mock.calls[0][0].where

    expect(listWhere).toEqual({
      name: { contains: "lighthouse", mode: "insensitive" },
    })
    expect(facilityCount.mock.calls[0][0].where).toEqual(listWhere)
    // The stats describe the console, so they run over the EMPTY scope the
    // search narrows from — not over the search.
    expect(facilityGroupBy.mock.calls[0][0].where).toEqual({})
    expect(memberCount.mock.calls[0][0].where).toEqual({
      organization: { facility: { is: {}, isNot: null } },
    })
    expect(contractCount.mock.calls[0][0].where).toEqual({
      facility: { is: {}, isNot: null },
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
    // Empty scope is the shape every real page load uses, and the one where an
    // orphan guard looks most redundant.
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
  [
    "vendor-table.tsx",
    "vendors",
    [
      ["Total Vendors", "catalogTotal"],
      ["Onboarded", "onboardedTotal"],
      ["Sales Reps", "repTotal"],
      ["Total Contracts", "contractTotal"],
    ],
  ],
  [
    "facility-table.tsx",
    "facilities",
    [
      ["Total Facilities", "catalogTotal"],
      ["Active", "activeTotal"],
      ["Total Users", "userTotal"],
      ["Total Contracts", "contractTotal"],
    ],
  ],
] as const)("%s stat row", (file, rows, cardSpec) => {
  const src = sourceWithoutComments(file)

  it("renders every card from the whole-catalog total that matches its label", () => {
    const cards = statCards(src)
    expect(cards.map(([, label]) => label)).toEqual(cardSpec.map(([l]) => l))
    cards.forEach(([expr, label], i) => {
      // `stat(data?.<field>)` and nothing else. Anything referencing the page
      // array is the original bug; `data?.total` is the 2026-07-28 one, since
      // `total` is the SEARCH's count and every label here says "Total".
      expect(expr, `"${label}" is not a server-side total`).toMatch(
        /^stat\(data\?\.\w+\)$/,
      )
      expect(expr).toBe(`stat(data?.${cardSpec[i][1]})`)
    })
  })

  it("never puts the search's count under a “Total” label", () => {
    // `total` is what the search matched — it belongs to the page range, which
    // names it alongside the catalog ("of 1 vendor matching “x” (of 200
    // total)"). On a card it reads as the size of the whole tenant list.
    expect(src).not.toContain("stat(data?.total)")
  })

  it("derives no card from the returned page", () => {
    for (const method of ["reduce", "filter", "length"]) {
      expect(src, `${rows}.${method} is page-scoped`).not.toContain(`${rows}.${method}(`)
    }
    // `?? vendors.length` was the old fallback — a page count wearing a tenant
    // label the moment the server total is missing.
    expect(src).not.toContain(`?? ${rows}.length`)
  })

  it("pages the rows for real instead of labelling the cap", () => {
    // Superseded the 2026-07-27 "Showing the first 20 of 201" caption on
    // 2026-07-28. A labelled cap beats a silent one, but the rows past it were
    // still unreachable: production ranks 21–200 of 200 vendors, "Stryker"
    // (rank 176, one of the two live production contracts) among them, could
    // not be opened from this console at all.
    expect(src, "no pager").toMatch(/setPage\(/)
    expect(src).toContain("Previous")
    expect(src).toContain("Next")
    // The last page has to be REACHABLE, so the upper bound is the server's
    // page count. Derive it from the page on screen and the pager stops one
    // page short of wherever the rows actually end.
    expect(src).toContain("data?.pageCount")
    expect(src).toContain("Math.min(pageCount, currentPage + 1)")
    expect(src, "the cap caption outlived the cap").not.toMatch(
      /Showing the first/,
    )
  })

  it("takes every number in the page summary from the server response", () => {
    // "Showing 1–20 of 20" is the original lie in a smaller font. `rowCount` is
    // the page — that is what it means — but every other field has to be the
    // server's, or the sentence quietly agrees with the bug.
    const summary = src.match(/describeAdminTablePage\(\{[\s\S]*?\}\)/)?.[0] ?? ""
    expect(summary, "no page summary found").not.toBe("")
    expect(summary).toContain(`rowCount: ${rows}.length`)
    for (const field of [
      "page: currentPage",
      "pageSize: data.pageSize",
      "total: data.total",
      "catalogTotal: data.catalogTotal",
      // The search the server ECHOED. `keepPreviousData` can still be showing
      // the previous search's rows while the next request is in flight.
      "search: data.search",
    ]) {
      expect(summary, `${field} must come from the server response`).toContain(
        field,
      )
    }
    expect(summary).not.toMatch(new RegExp(`total: ${rows}\\.length`))
  })

  it("reads the page the server served back off the response", () => {
    // The server clamps the requested page into range; deleting the last row
    // on the last page moves where the last page is. Trust local state over
    // the response and the pager points at a page that no longer exists.
    expect(src).toContain("const currentPage = data?.page ?? 1")
  })

  it("searches on the server rather than inside the page", () => {
    // DataTable's `searchKey` filters the rows it HOLDS. With the rows paged
    // server-side that is 20 of 201, so searching "stryker" from page 1
    // answered "No results found." — a page-scoped denominator under a
    // whole-set question.
    expect(src, "searchKey searches one page").not.toContain("searchKey")
    expect(src).toContain("search: searchTerm")
  })

  it("shows a real zero instead of the loading dash", () => {
    // `??`, never `||`. A tenant with 0 onboarded vendors has a true answer;
    // rendering it as "—" hides a real number behind "still loading", which is
    // the same defect pointed the other way.
    expect(src).toContain(`const stat = (value: number | undefined) => value ?? "—"`)
  })
})
