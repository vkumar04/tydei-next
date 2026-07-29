/**
 * Parity + behaviour tests for the canonical COG filter.
 *
 * The bug this pins (Charles 2026-07-28): `getCOGRecords` and the CSV export
 * endpoint each hand-rolled their own `where`, and the export's copy silently
 * omitted `search`. An operator searched "Stryker", saw the table narrow to
 * ~108 rows, hit Export, and got all 49,269 facility rows under a filename
 * identical to a correctly-filtered one.
 *
 * The structural fix is that both callers now build their clause from
 * `cogRecordWhere`. The test that matters most is therefore not any single
 * assertion below but `sources use the shared helper` — it fails if someone
 * reintroduces a second hand-rolled copy, which is the only way this class of
 * defect comes back.
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { cogRecordWhere, hasCogFilters } from "../cog-record-filter"

const ROOT = join(__dirname, "..", "..", "..")
const ACTION = join(ROOT, "lib/actions/cog-records.ts")
const EXPORT_ROUTE = join(ROOT, "app/api/cog/export/route.ts")
const TABLE = join(ROOT, "components/facility/cog/cog-records-table.tsx")

/** Pull the AND[] conditions out for readable assertions. */
const conditions = (w: ReturnType<typeof cogRecordWhere>) =>
  (w.AND ?? []) as Record<string, unknown>[]

describe("cogRecordWhere", () => {
  it("always binds facilityId as the first condition", () => {
    // The tenant boundary is positional, not part of the filter bag, so a
    // caller cannot omit it by passing an object that lacks one.
    expect(conditions(cogRecordWhere("fac_1"))[0]).toEqual({ facilityId: "fac_1" })
  })

  it("searches description, inventory number AND vendor item number", () => {
    const or = conditions(cogRecordWhere("f", { search: "Stryker" })).find(
      (c) => "OR" in c,
    )?.OR as Record<string, unknown>[]

    expect(or).toHaveLength(3)
    expect(or.map((c) => Object.keys(c)[0]).sort()).toEqual([
      "inventoryDescription",
      "inventoryNumber",
      "vendorItemNo",
    ])
    // Case-insensitive: SKUs and descriptions are operator-typed free text,
    // and a case-sensitive `contains` under-counts (CLAUDE.md hard rule).
    for (const c of or) {
      expect(Object.values(c)[0]).toMatchObject({
        contains: "Stryker",
        mode: "insensitive",
      })
    }
  })

  it("trims search and ignores whitespace-only input", () => {
    expect(conditions(cogRecordWhere("f", { search: "  Mako  " })).some((c) => "OR" in c)).toBe(true)
    const or = conditions(cogRecordWhere("f", { search: " Mako " })).find((c) => "OR" in c)
      ?.OR as Record<string, unknown>[]
    expect(Object.values(or[0])[0]).toMatchObject({ contains: "Mako" })

    // Whitespace-only must not become a filter — it would match nothing and
    // render an empty table for what the user experiences as "no search".
    expect(conditions(cogRecordWhere("f", { search: "   " })).some((c) => "OR" in c)).toBe(false)
  })

  it("expands the variance_only convenience to both real statuses", () => {
    const c = conditions(cogRecordWhere("f", { matchStatus: "variance_only" })).find(
      (x) => "matchStatus" in x,
    )
    expect(c).toEqual({
      matchStatus: { in: ["off_contract_item", "price_variance"] },
    })
  })

  it("passes a literal status straight through", () => {
    const c = conditions(cogRecordWhere("f", { matchStatus: "on_contract" })).find(
      (x) => "matchStatus" in x,
    )
    expect(c).toEqual({ matchStatus: "on_contract" })
  })

  it("ignores an unrecognised status instead of querying it", () => {
    // The export endpoint reads this straight off a query string. Pushing an
    // arbitrary string at an enum column is a 500, not a filter.
    const w = cogRecordWhere("f", { matchStatus: "'; drop table--" })
    expect(conditions(w).some((c) => "matchStatus" in c)).toBe(false)
    expect(conditions(w)).toEqual([{ facilityId: "f" }])
  })

  it("ignores unparseable dates rather than producing an Invalid Date", () => {
    const w = cogRecordWhere("f", { dateFrom: "garbage", dateTo: "2026-01-31" })
    const dates = conditions(w).filter((c) => "transactionDate" in c)
    expect(dates).toHaveLength(1)
    expect(dates[0]).toEqual({ transactionDate: { lte: new Date("2026-01-31") } })
  })

  it("combines every filter as AND", () => {
    const w = cogRecordWhere("fac_1", {
      search: "Mako",
      vendorId: "v1",
      matchStatus: "price_variance",
      dateFrom: "2026-01-01",
      dateTo: "2026-06-30",
    })
    expect(conditions(w)).toHaveLength(6) // facility + search + vendor + status + 2 dates
  })
})

describe("hasCogFilters", () => {
  it("counts search — the omission that produced the wrong empty state", () => {
    expect(hasCogFilters({ search: "Stryker" })).toBe(true)
  })

  it("ignores whitespace-only search", () => {
    expect(hasCogFilters({ search: "  " })).toBe(false)
  })

  it("is false with no filters", () => {
    expect(hasCogFilters()).toBe(false)
    expect(hasCogFilters({})).toBe(false)
  })

  it.each(["vendorId", "matchStatus", "dateFrom", "dateTo"] as const)(
    "counts %s",
    (key) => {
      expect(hasCogFilters({ [key]: "x" })).toBe(true)
    },
  )
})

describe("sources use the shared helper", () => {
  // THE load-bearing test. Every assertion above passes just as happily if a
  // caller stops using the helper and hand-rolls its own clause again — which
  // is precisely how the original bug arose.
  it.each([
    ["the list action", ACTION],
    ["the CSV export route", EXPORT_ROUTE],
  ])("%s builds its where from cogRecordWhere", (_label, file) => {
    const src = readFileSync(file, "utf8")
    expect(src).toContain("cogRecordWhere")
    expect(src).toMatch(/from ["']@\/lib\/contracts\/cog-record-filter["']/)
  })

  it("neither source hand-rolls the search OR clause", () => {
    for (const file of [ACTION, EXPORT_ROUTE]) {
      const src = readFileSync(file, "utf8")
      expect(src).not.toContain("inventoryDescription: { contains")
    }
  })

  it("the export route forwards search from the query string", () => {
    const src = readFileSync(EXPORT_ROUTE, "utf8")
    expect(src).toMatch(/search:\s*url\.searchParams\.get\(["']search["']\)/)
  })

  it("the table sends search to the export endpoint", () => {
    // The client half: the param has to actually be put on the URL. Without
    // this the route's support for it is dead code.
    const src = readFileSync(TABLE, "utf8")
    expect(src).toMatch(/params\.set\(["']search["']/)
  })

  it("the table reports export scope from the server's own counts", () => {
    // A toast that says "Exported N records" while the file holds a capped
    // slice is the same lie in a smaller font.
    const src = readFileSync(TABLE, "utf8")
    expect(src).toContain("X-Rows-Exported")
    expect(src).toContain("X-Total-Matched")
  })

  it("the export names a truncated file so it cannot pass as complete", () => {
    const src = readFileSync(EXPORT_ROUTE, "utf8")
    expect(src).toMatch(/first-\$\{records\.length\}-of-\$\{matched\}/)
  })
})
