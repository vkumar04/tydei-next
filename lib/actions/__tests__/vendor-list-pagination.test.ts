/**
 * Facility Settings → Vendors must be able to REACH every vendor and SAY how
 * many there are.
 *
 * The shipped bug: the tab asked for `getVendorList({ search, page: 1,
 * pageSize: 100 })` and rendered the result as the complete list — no pager, no
 * row count, and the `total` the action already returned was never read.
 * Production holds 200 vendors, so alphabetical ranks 101 ("KOVEN") through 200
 * ("Zimmer US, Inc.") were invisible, including "Stryker" at rank 176, which
 * holds one of the two live production contracts. 94 of the 100 hidden vendors
 * carry COG rows (22,943 of them), so this was not catalog padding.
 *
 * Worse, `Vendor.name` has no unique constraint and "Add Vendor" sits directly
 * above the table: scroll, fail to find Stryker, click Add Vendor, and you have
 * a second Stryker splitting COG matching across two vendor ids.
 *
 * These tests pin both halves: the page never masquerades as the catalog, and
 * an exact duplicate name is refused.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

// ─── A production-shaped catalog ────────────────────────────────
//
// 200 vendors whose alphabetical rank is known: 175 fillers, then "Stryker" at
// rank 176, then 23 more fillers, then "Zimmer US, Inc." dead last at rank 200.

interface VendorRow {
  id: string
  name: string
  code: string | null
  displayName: string | null
  status: string
}

function catalog(): VendorRow[] {
  const rows: VendorRow[] = []
  for (let i = 1; i <= 175; i++) {
    rows.push({
      id: `a-${i}`,
      name: `A-${String(i).padStart(3, "0")} Medical`,
      code: `A${String(i).padStart(3, "0")}`,
      displayName: null,
      status: "active",
    })
  }
  rows.push({ id: "stryker", name: "Stryker", code: "STK", displayName: null, status: "active" })
  for (let i = 1; i <= 23; i++) {
    rows.push({
      id: `z-${i}`,
      name: `Z-${String(i).padStart(3, "0")} Supply`,
      code: `Z${String(i).padStart(3, "0")}`,
      displayName: null,
      status: "active",
    })
  }
  rows.push({ id: "zimmer", name: "Zimmer US, Inc.", code: "ZIM", displayName: null, status: "active" })
  return rows
}

// ─── Minimal Prisma stand-in (where + orderBy + skip/take) ──────

interface StringFilter {
  contains?: string
  equals?: string
  mode?: string
}
interface VendorWhere {
  AND?: VendorWhere[]
  OR?: VendorWhere[]
  status?: string
  name?: StringFilter
  code?: StringFilter
  displayName?: StringFilter
}

function fieldMatches(value: string | null, filter: StringFilter): boolean {
  const insensitive = filter.mode === "insensitive"
  const left = insensitive ? (value ?? "").toLowerCase() : (value ?? "")
  if (filter.contains !== undefined) {
    const needle = insensitive ? filter.contains.toLowerCase() : filter.contains
    return value !== null && left.includes(needle)
  }
  if (filter.equals !== undefined) {
    const needle = insensitive ? filter.equals.toLowerCase() : filter.equals
    return value !== null && left === needle
  }
  return true
}

function matches(row: VendorRow, where: VendorWhere | undefined): boolean {
  if (!where) return true
  if (where.AND && !where.AND.every((w) => matches(row, w))) return false
  if (where.OR && !where.OR.some((w) => matches(row, w))) return false
  if (where.status !== undefined && row.status !== where.status) return false
  if (where.name && !fieldMatches(row.name, where.name)) return false
  if (where.code && !fieldMatches(row.code, where.code)) return false
  if (where.displayName && !fieldMatches(row.displayName, where.displayName)) return false
  return true
}

let rows: VendorRow[] = []

interface FindManyArgs {
  where?: VendorWhere
  skip?: number
  take?: number
  orderBy?: { name?: "asc" | "desc" }
}

const findMany = vi.fn(async (args: FindManyArgs) => {
  const filtered = rows
    .filter((r) => matches(r, args.where))
    .sort((a, b) => a.name.localeCompare(b.name))
  const skip = args.skip ?? 0
  return args.take === undefined
    ? filtered.slice(skip)
    : filtered.slice(skip, skip + args.take)
})
const count = vi.fn(async (args?: { where?: VendorWhere }) =>
  rows.filter((r) => matches(r, args?.where)).length,
)
const findFirst = vi.fn(async (args: { where?: VendorWhere }) =>
  rows.find((r) => matches(r, args.where)) ?? null,
)
const create = vi.fn(
  async (args: { data: { name: string; displayName?: string } }) => ({
    id: "new-vendor",
    ...args.data,
  }),
)

vi.mock("@/lib/db", () => ({
  prisma: {
    vendor: {
      findMany: (a: FindManyArgs) => findMany(a),
      count: (a?: { where?: VendorWhere }) => count(a),
      findFirst: (a: { where?: VendorWhere }) => findFirst(a),
      create: (a: { data: { name: string; displayName?: string } }) => create(a),
    },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn().mockResolvedValue({}),
  requireAdmin: vi.fn().mockResolvedValue({}),
}))
vi.mock("@/lib/actions/auth-permissions", () => ({
  requireCanMutate: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/serialize", () => ({ serialize: <T,>(v: T) => v }))

beforeEach(() => {
  vi.clearAllMocks()
  rows = catalog()
})

const load = () => import("@/lib/actions/vendors")

describe("getVendorList — the page never masquerades as the catalog", () => {
  it("returns one page of rows alongside the catalog-wide total", async () => {
    const { getVendorList } = await load()
    const res = await getVendorList({ page: 1, pageSize: 25 })

    expect(res.vendors).toHaveLength(25)
    // The defect being eliminated: `vendors.length` standing in for `total`.
    expect(res.total).toBe(200)
    expect(res.total).not.toBe(res.vendors.length)
    expect(res.pageCount).toBe(8)
    expect(res.page).toBe(1)
    expect(res.pageSize).toBe(25)
  })

  it("makes every vendor reachable by paging — Stryker (rank 176) and Zimmer (200) included", async () => {
    const { getVendorList } = await load()
    const first = await getVendorList({ page: 1, pageSize: 25 })

    const seen: string[] = []
    for (let page = 1; page <= first.pageCount; page++) {
      const res = await getVendorList({ page, pageSize: 25 })
      seen.push(...res.vendors.map((v) => v.name))
    }

    expect(seen).toHaveLength(200)
    expect(new Set(seen).size).toBe(200)
    expect(seen).toContain("Stryker")
    expect(seen).toContain("Zimmer US, Inc.")
    // …and they are genuinely past the old single-page window.
    expect(seen.indexOf("Stryker")).toBe(175)
    expect(first.vendors.map((v) => v.name)).not.toContain("Stryker")
  })

  it("counts and rows come from the SAME where clause", async () => {
    const { getVendorList } = await load()
    await getVendorList({ search: "stryker", page: 1, pageSize: 25 })

    const rowsWhere = findMany.mock.calls[0][0].where
    const filteredCountWhere = count.mock.calls[0][0]?.where
    expect(filteredCountWhere).toEqual(rowsWhere)
  })

  it("searches the whole catalog server-side, not the page the client holds", async () => {
    const { getVendorList } = await load()
    // "Stryker" is on page 8 of 8; a client-side filter over page 1 finds nothing.
    const res = await getVendorList({ search: "stryk", page: 1, pageSize: 25 })

    expect(res.vendors.map((v) => v.name)).toEqual(["Stryker"])
    expect(res.total).toBe(1)
    // The catalog count stays the catalog count — it is a different scope and
    // is labelled as one.
    expect(res.catalogTotal).toBe(200)
    expect(res.pageCount).toBe(1)
  })

  it("echoes the search its counts were computed under", async () => {
    const { getVendorList } = await load()
    // The client renders the previous page while the next one loads, so the
    // label must be driven by the response, not by the input box.
    const res = await getVendorList({ search: "  stryk  ", page: 1 })

    expect(res.search).toBe("stryk")
    expect((await getVendorList({ page: 1 })).search).toBe("")
    expect((await getVendorList({ search: "   ", page: 1 })).total).toBe(200)
  })

  it("matches search case-insensitively on name, code and display name", async () => {
    rows.push({
      id: "howmedica",
      name: "Howmedica Osteonics",
      code: "HOW",
      displayName: "Stryker Ortho",
      status: "active",
    })
    const { getVendorList } = await load()

    expect((await getVendorList({ search: "STRYKER" })).total).toBe(2)
    expect((await getVendorList({ search: "stk" })).total).toBe(1)
  })

  it("clamps an out-of-range page instead of rendering an empty table", async () => {
    const { getVendorList } = await load()
    // Deactivating rows or narrowing a search can strand a client on page 9.
    const res = await getVendorList({ page: 99, pageSize: 25 })

    expect(res.page).toBe(8)
    expect(res.vendors).toHaveLength(25)
    expect(res.vendors.at(-1)?.name).toBe("Zimmer US, Inc.")
  })

  it("reports page 1 of 1 for an empty result rather than dividing by zero", async () => {
    const { getVendorList } = await load()
    const res = await getVendorList({ search: "no-such-vendor" })

    expect(res.vendors).toHaveLength(0)
    expect(res.total).toBe(0)
    expect(res.page).toBe(1)
    expect(res.pageCount).toBe(1)
    expect(res.catalogTotal).toBe(200)
  })

  it("spends one extra count only when a search is active", async () => {
    const { getVendorList } = await load()
    await getVendorList({ page: 1, pageSize: 25 })
    expect(count).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    await getVendorList({ status: "active" })
    // A status filter alone leaves the two scopes identical — no second query.
    expect(count).toHaveBeenCalledTimes(1)

    vi.clearAllMocks()
    await getVendorList({ search: "stryk" })
    expect(count).toHaveBeenCalledTimes(2)
  })

  it("counts the scope the search RAN OVER, not every row that exists", async () => {
    // One inactive vendor the status filter excludes. "searched all N vendors"
    // must mean the N the search could have matched — quoting the wider 201
    // would be the same defect as quoting a page as a total.
    rows.push({ id: "koven", name: "KOVEN", code: null, displayName: null, status: "inactive" })
    const { getVendorList } = await load()

    const miss = await getVendorList({ status: "active", search: "no-such-vendor" })
    expect(miss.total).toBe(0)
    expect(miss.catalogTotal).toBe(200)

    // …and with no search at all the two scopes are the same number.
    const all = await getVendorList({ status: "active" })
    expect(all.total).toBe(200)
    expect(all.catalogTotal).toBe(200)
  })

  it("defaults to a real page size rather than the whole table", async () => {
    const { getVendorList } = await load()
    const { VENDOR_PAGE_SIZE } = await import("@/lib/validators/vendors")
    const res = await getVendorList({})

    expect(res.pageSize).toBe(VENDOR_PAGE_SIZE)
    expect(res.vendors).toHaveLength(VENDOR_PAGE_SIZE)
    expect(findMany.mock.calls[0][0].take).toBe(VENDOR_PAGE_SIZE)
  })

  it("still refuses a page size above the transport cap — paging is the fix, not a bigger page", async () => {
    const { getVendorList } = await load()
    const { VENDOR_MAX_PAGE_SIZE } = await import("@/lib/validators/vendors")

    expect(VENDOR_MAX_PAGE_SIZE).toBe(100)
    await expect(
      getVendorList({ pageSize: VENDOR_MAX_PAGE_SIZE + 1 }),
    ).rejects.toThrow()
  })
})

describe("createVendor — the truncated list must not mint duplicates", () => {
  it("refuses an exact name collision and names the row that already exists", async () => {
    const { createVendor } = await load()

    await expect(
      createVendor({ name: "  stryker ", tier: "standard" }),
    ).rejects.toThrow(/Stryker.*already exists/)
    expect(create).not.toHaveBeenCalled()
  })

  it("refuses a collision against an existing display name too", async () => {
    rows.push({
      id: "howmedica",
      name: "Howmedica Osteonics",
      code: "HOW",
      displayName: "Stryker Ortho",
      status: "active",
    })
    const { createVendor } = await load()

    await expect(
      createVendor({ name: "Stryker Ortho", tier: "standard" }),
    ).rejects.toThrow(/already exists/)
    expect(create).not.toHaveBeenCalled()
  })

  it("says so when the existing row is inactive, since it is invisible in an active-only view", async () => {
    rows.push({ id: "koven", name: "KOVEN", code: null, displayName: null, status: "inactive" })
    const { createVendor } = await load()

    await expect(createVendor({ name: "Koven", tier: "standard" })).rejects.toThrow(
      /currently inactive/,
    )
  })

  it("refuses a new row whose DISPLAY name collides with an existing vendor", async () => {
    const { createVendor } = await load()

    // The same duplicate, entered in the other box.
    await expect(
      createVendor({
        name: "Howmedica Osteonics",
        displayName: "  stryker ",
        tier: "standard",
      }),
    ).rejects.toThrow(/Stryker.*already exists/)
    expect(create).not.toHaveBeenCalled()
  })

  it("does not refuse every create when there is no display name to compare", async () => {
    // A Prisma `equals: undefined` is "no filter", which inside the collision
    // OR would match the first row in the table and block all creates.
    const { createVendor } = await load()
    await createVendor({ name: "Arthrex", tier: "standard" })

    expect(create).toHaveBeenCalledTimes(1)
  })

  it("creates a genuinely new vendor, trimmed", async () => {
    const { createVendor } = await load()
    await createVendor({ name: "  Arthrex  ", displayName: "  Arthrex Inc.  ", tier: "standard" })

    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].data.name).toBe("Arthrex")
    // Stored trimmed because it was COMPARED trimmed; otherwise the stored
    // value no longer equals its own trimmed form and the guard misses it next
    // time.
    expect(create.mock.calls[0][0].data.displayName).toBe("Arthrex Inc.")
  })
})
