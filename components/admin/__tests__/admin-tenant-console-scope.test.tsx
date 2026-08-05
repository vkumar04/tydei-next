import { describe, it, expect } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { QueryClient } from "@tanstack/react-query"
import type { RowData } from "@tanstack/react-table"
import type {
  TableCellContext,
  ColumnDef,
} from "@/components/shared/tables/table-features"

import {
  describeAdminTablePage,
  describeAdminTableControlScope,
} from "@/components/admin/admin-table-page-summary"
import { getAdminVendorColumns } from "@/components/admin/vendor-columns"
import { getFacilityColumns } from "@/components/admin/facility-columns"
import type { AdminVendorRow } from "@/lib/actions/admin/vendors"
import type { AdminFacilityRow } from "@/lib/actions/admin/facilities"
import { queryKeys } from "@/lib/query-keys"

/**
 * The admin tenant consoles (/admin/vendors, /admin/facilities), pinned against
 * the "computed from the wrong scope, presented as the whole truth" class.
 *
 * Three defects, all verified against the production snapshot (200 vendors, 2
 * facilities, 2 live contracts) on 2026-07-28:
 *
 *  1. The Vendors table rendered ONE server page (`pageSize: 20`) with no
 *     pager, so ranks 21–200 were unreachable from the console — including
 *     "Stryker" at rank 176, which holds one of the two live production
 *     contracts. The stat cards above it had already been fixed; the rows had
 *     not, and the caption "Showing the first 20 of 201" labelled the cap
 *     rather than removing it.
 *
 *  2. `Vendor.tier` (`VendorTier @default(standard)`) rendered as a "Category"
 *     badge with a faceted select filter, though no application write path sets
 *     it — 199 of 200 production rows are the default, the lone "premium" was
 *     written by hand months before those paths existed, and page 1 of the
 *     console is 20 standard rows, i.e. a filter whose one option matches every
 *     row. `Facility.status` looks identical and is NOT the same defect: the
 *     Stripe webhook really does write it, so that column survived.
 *
 *  3. `queryKeys.admin.vendors()` carried a comment claiming it shared a prefix
 *     with `vendorOptions()` "so creating a tenant refreshes them". It did not.
 *
 *  4. (review pass, same day) the fix for 1 moved the four stat cards to the
 *     server but computed them over the SEARCHED filter, so typing "stryker"
 *     rewrote "Total Vendors" to 1 — the same wrong-scope defect one level
 *     down. The cards are now the catalog; the sentence below the table is the
 *     only thing that follows the search, and it names both numbers. The
 *     server side of that is pinned in
 *     lib/actions/admin/__tests__/admin-list-stat-scope.test.ts.
 */

// ─── 1. The page summary ─────────────────────────────────────────
//
// Pure, so it is tested directly the way `describeVendorPage` is
// (components/facility/settings/__tests__/vendors-tab-summary.test.ts).

const VENDORS = ["vendor", "vendors"] as const
const FACILITIES = ["facility", "facilities"] as const

describe("describeAdminTablePage", () => {
  it("reports the whole-set total, not the size of the page", () => {
    const label = describeAdminTablePage({
      rowCount: 20,
      page: 1,
      pageSize: 20,
      total: 200,
      catalogTotal: 200,
      search: "",
      noun: VENDORS,
    })
    expect(label).toBe("Showing 1–20 of 200 vendors")
    // The exact regression: "200" must be the denominator, "20" must not.
    expect(label).not.toBe("Showing 1–20 of 20 vendors")
  })

  it("moves the range with the page so rank 176 is visibly reachable", () => {
    // Stryker sits at alphabetical rank 176 of 200 in production and holds a
    // live contract. Page 9 is the page that contains it.
    expect(
      describeAdminTablePage({
        rowCount: 20,
        page: 9,
        pageSize: 20,
        total: 200,
        catalogTotal: 200,
        search: "",
        noun: VENDORS,
      }),
    ).toBe("Showing 161–180 of 200 vendors")
  })

  it("handles a short final page", () => {
    expect(
      describeAdminTablePage({
        rowCount: 7,
        page: 11,
        pageSize: 20,
        total: 207,
        catalogTotal: 207,
        search: "",
        noun: VENDORS,
      }),
    ).toBe("Showing 201–207 of 207 vendors")
  })

  it("keeps the matching count and the console's whole scope separately labelled", () => {
    const label = describeAdminTablePage({
      rowCount: 1,
      page: 1,
      pageSize: 20,
      total: 1,
      catalogTotal: 200,
      search: "stryk",
      noun: VENDORS,
    })
    expect(label).toBe("Showing 1–1 of 1 vendor matching “stryk” (of 200 total)")
  })

  it("is the ONLY place the search's count appears, so it names the catalog too", () => {
    // The stat cards above the table are the catalog (200) and do not move
    // when the operator types — see admin-list-stat-scope.test.ts. That only
    // works if this sentence carries the matched count AND the catalog, or the
    // screen loses the answer to "how many matched" entirely.
    const label = describeAdminTablePage({
      rowCount: 1,
      page: 1,
      pageSize: 20,
      total: 1,
      catalogTotal: 200,
      search: "stryker",
      noun: VENDORS,
    })
    expect(label).toContain("of 1 vendor")
    expect(label).toContain("(of 200 total)")
  })

  it("pluralises the two counts independently", () => {
    // catalogTotal and total are different quantities and can disagree about
    // plurality; sharing one noun produced "searched all 1 vendors".
    expect(
      describeAdminTablePage({
        rowCount: 0,
        page: 1,
        pageSize: 20,
        total: 0,
        catalogTotal: 1,
        search: "zimmer",
        noun: VENDORS,
      }),
    ).toBe("No vendors match “zimmer” — searched all 1 vendor.")
  })

  it("says an empty search covered the whole console, not just this page", () => {
    expect(
      describeAdminTablePage({
        rowCount: 0,
        page: 1,
        pageSize: 20,
        total: 0,
        catalogTotal: 200,
        search: " zimme r ".trim(),
        noun: VENDORS,
      }),
    ).toBe("No vendors match “zimme r” — searched all 200 vendors.")
  })

  it("never renders a backwards range when the page holds no rows", () => {
    // `total` and the rows come from two round trips; a delete landing between
    // them leaves a non-empty total with an empty page. Naive arithmetic would
    // say "Showing 21–20 of 200 vendors".
    const label = describeAdminTablePage({
      rowCount: 0,
      page: 2,
      pageSize: 20,
      total: 200,
      catalogTotal: 200,
      search: "",
      noun: VENDORS,
    })
    expect(label).toBe("No vendors on page 2 — 200 vendors in total.")
    expect(label).not.toMatch(/21–20/)
  })

  it("distinguishes an empty console from an empty search result", () => {
    expect(
      describeAdminTablePage({
        rowCount: 0,
        page: 1,
        pageSize: 20,
        total: 0,
        catalogTotal: 0,
        search: "",
        noun: FACILITIES,
      }),
    ).toBe("No facilities yet.")
  })

  it("ignores a whitespace-only search the way the server does", () => {
    expect(
      describeAdminTablePage({
        rowCount: 2,
        page: 1,
        pageSize: 20,
        total: 2,
        catalogTotal: 2,
        search: "   ",
        noun: FACILITIES,
      }),
    ).toBe("Showing 1–2 of 2 facilities")
  })
})

describe("describeAdminTableControlScope", () => {
  it("says which controls see one page and which see all of them", () => {
    // Sorting and the per-column filters live in TanStack Table and only ever
    // see the rows the server sent; search runs in Postgres. Unsaid, a column
    // filter returning nothing reads as "none exist".
    expect(
      describeAdminTableControlScope({
        rowCount: 20,
        pageCount: 10,
        catalogTotal: 200,
        noun: VENDORS,
      }),
    ).toBe(
      "Sorting and the column filters apply to the 20 rows on this page; " +
        "search covers all 200 vendors.",
    )
  })

  it("stays quiet when one page IS the whole set", () => {
    // Both production facilities fit on page 1; the caveat would be noise, and
    // a caveat that is noise is a caveat nobody reads on the day it matters.
    expect(
      describeAdminTableControlScope({
        rowCount: 2,
        pageCount: 1,
        catalogTotal: 2,
        noun: FACILITIES,
      }),
    ).toBeNull()
  })
})

// ─── 2. Columns: the filter list must equal the rendered cells ───

/**
 * TanStack v8 builds a faceted "select" filter's options from the COLUMN's
 * values (`getFacetedUniqueValues`), not from what the cell draws. A cell that
 * renders a different string than its accessor produces gives the operator a
 * filter list that disagrees with the rows beside it — so for every select
 * column, accessor output and cell text have to be the same string.
 */
function cellText<T extends RowData>(column: ColumnDef<T>, row: T, value: unknown): string {
  const { cell } = column
  if (typeof cell !== "function") throw new Error("column has no cell renderer")
  const context = {
    getValue: () => value,
    row: { original: row },
  } as unknown as TableCellContext<T, unknown>
  return renderToStaticMarkup(<>{cell(context)}</>)
    .replace(/<[^>]*>/g, "")
    .trim()
}

function accessorValue<T extends RowData>(column: ColumnDef<T>, row: T): unknown {
  const accessor = "accessorFn" in column ? column.accessorFn : undefined
  if (typeof accessor !== "function") {
    throw new Error("column has no accessorFn")
  }
  return accessor(row, 0)
}

function vendorRow(overrides: Partial<AdminVendorRow> = {}): AdminVendorRow {
  return {
    id: "v-1",
    name: "Stryker",
    code: null,
    contactName: null,
    contactEmail: null,
    status: "active",
    tier: "standard",
    contractCount: 1,
    repCount: 0,
    createdAt: "2026-04-07T15:33:18.313Z",
    canHaveUsers: true,
    ...overrides,
  }
}

function facilityRow(overrides: Partial<AdminFacilityRow> = {}): AdminFacilityRow {
  return {
    id: "f-1",
    name: "Lighthouse Surgical Center",
    type: "asc",
    city: "Boston",
    state: "MA",
    beds: 12,
    status: "active",
    healthSystemName: null,
    userCount: 3,
    contractCount: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    canHaveUsers: true,
    ...overrides,
  }
}

const vendorColumns = getAdminVendorColumns(
  () => {},
  () => {},
)
const facilityColumns = getFacilityColumns(
  () => {},
  () => {},
  () => {},
)

const vendorTier = vendorColumns.find((c) => c.id === "tier")
const facilityStatus = facilityColumns.find((c) => c.id === "status")

describe("Vendor.tier column", () => {
  it("no longer calls an unsettable service tier a Category", () => {
    expect(vendorTier, "the tier column disappeared entirely").toBeDefined()
    expect(vendorTier?.header).toBe("Tier")
    for (const column of vendorColumns) {
      expect(column.header).not.toBe("Category")
    }
  })

  it("offers no faceted filter over a column nothing writes", () => {
    // The options come from the rows the CLIENT holds — one server page. Page 1
    // of production is 20 "standard" vendors, so the control was a filter whose
    // single choice matched every row: the exact shape removed from Status.
    expect(vendorTier?.meta?.filterVariant).toBe("none")
  })

  it("renders the schema default as absence, not as a decision", () => {
    // `@default(standard)`, and verified 2026-07-28 that no write path sets it:
    // every createVendor call site hard-codes "standard", updateVendor is never
    // passed a tier, the admin form has no tier control, and
    // lib/vendors/resolve.ts (which mints vendors from imports) never touches
    // it. 199 of 200 production rows are the default.
    const standard = vendorRow({ tier: "standard" })
    expect(accessorValue(vendorTier!, standard)).toBe("")
    expect(cellText(vendorTier!, standard, "")).toBe("—")
    expect(cellText(vendorTier!, standard, "")).not.toMatch(/standard/i)
  })

  it("still surfaces an explicit promotion off the default", () => {
    // Production's lone "premium" is Stryker. Blanking the column entirely
    // would trade one wrong scope for a different missing fact.
    const premium = vendorRow({ tier: "premium" })
    expect(accessorValue(vendorTier!, premium)).toBe("premium")
    expect(cellText(vendorTier!, premium, "premium")).toBe("premium")
  })
})

describe("Facility.status column", () => {
  it("keeps the column, because the Stripe webhook really writes it", () => {
    // The counterpart check to Vendor.tier: `Facility.status` is also a
    // `@default("active")`, but lib/billing/stripe-webhook.ts sets it to
    // "inactive" on subscription cancellation. A default WITH a writer is a
    // fact; a default with none is a decoration.
    expect(facilityStatus, "the status column disappeared entirely").toBeDefined()
    expect(facilityStatus?.meta?.filterVariant).toBe("select")
  })

  it("gives the filter list the same strings the cells show", () => {
    // Keyed on `status` the filter listed the raw enum — "active"/"inactive" —
    // beside cells reading "Active"/"Inactive".
    for (const status of ["active", "inactive"]) {
      const row = facilityRow({ status })
      const faceted = accessorValue(facilityStatus!, row)
      expect(typeof faceted).toBe("string")
      expect(cellText(facilityStatus!, row, faceted)).toBe(faceted)
    }
  })

  it("carries an explicit id, as TanStack v8 requires alongside accessorFn", () => {
    for (const column of [vendorTier, facilityStatus]) {
      expect("accessorFn" in column!).toBe(true)
      expect(column?.id).toBeTruthy()
    }
  })
})

// ─── 3. The Access picker's cache invalidation ───────────────────

describe("queryKeys.admin tenant families", () => {
  /** Seed the two queries a tenant console page actually holds. */
  function seeded(): QueryClient {
    const qc = new QueryClient()
    qc.setQueryData(queryKeys.admin.vendors({ page: 1, search: "" }), { vendors: [] })
    qc.setQueryData(queryKeys.admin.vendors({ page: 9, search: "" }), { vendors: [] })
    qc.setQueryData(queryKeys.admin.vendorOptions(), [])
    qc.setQueryData(queryKeys.admin.facilities({ page: 1, search: "" }), { facilities: [] })
    qc.setQueryData(queryKeys.admin.facilityOptions(), [])
    return qc
  }

  it("refreshes the Access picker when a tenant is created", () => {
    // The claim the old comment made and did not keep. TanStack's
    // `partialMatchKey` walks the FILTER key's full length, so the previous
    // 3-element `["admin","vendors",undefined]` compared `undefined` against
    // `"options"` at index 2 and matched nothing: creating a vendor left the
    // user-creation Access picker showing a catalog without it.
    const qc = seeded()
    const matched = qc
      .getQueryCache()
      .findAll({ queryKey: queryKeys.admin.vendorsBase })
      .map((q) => q.queryKey)
    expect(matched).toContainEqual(queryKeys.admin.vendorOptions())
    expect(matched).toHaveLength(3) // two pages + the option list
  })

  it("matches from the bare no-filter call too, not just the explicit base", () => {
    // Call sites outside this console invalidate with `admin.vendors()`. That
    // has to keep working, which is why the no-filter branch collapses to the
    // 2-element base instead of appending `undefined`.
    const qc = seeded()
    expect(queryKeys.admin.vendors()).toEqual(queryKeys.admin.vendorsBase)
    expect(queryKeys.admin.facilities()).toEqual(queryKeys.admin.facilitiesBase)
    expect(
      qc.getQueryCache().findAll({ queryKey: queryKeys.admin.vendors() }),
    ).toHaveLength(3)
    expect(
      qc.getQueryCache().findAll({ queryKey: queryKeys.admin.facilities() }),
    ).toHaveLength(2)
  })

  it("does not let the two consoles invalidate each other", () => {
    const qc = seeded()
    const facilityKeys = qc
      .getQueryCache()
      .findAll({ queryKey: queryKeys.admin.facilitiesBase })
      .map((q) => q.queryKey)
    expect(facilityKeys).not.toContainEqual(queryKeys.admin.vendorOptions())
  })

  it("never appends `undefined` to a no-filter admin list key", () => {
    /**
     * The generic form of defect 3, so the next family added here cannot
     * reintroduce it. `partialMatchKey` walks the FILTER key's full length, so
     * a 3-element `["admin", x, undefined]` compares `undefined` against the
     * sibling key's real third element and matches nothing — which is why
     * `vendors()` never reached `vendorOptions()`, and why the payor-contract
     * table had to hand-write two invalidations for one family.
     */
    const factories = {
      facilities: queryKeys.admin.facilities,
      vendors: queryKeys.admin.vendors,
      users: queryKeys.admin.users,
      subscriptions: queryKeys.admin.subscriptions,
      invoices: queryKeys.admin.invoices,
      payorContracts: queryKeys.admin.payorContracts,
    }
    for (const [name, factory] of Object.entries(factories)) {
      const base = factory()
      expect(base, `${name}() padded its key with undefined`).not.toContain(
        undefined,
      )
      expect(base, `${name}() should be the 2-element family prefix`).toHaveLength(2)
      // …and it must actually be a PREFIX of the filtered form, which is the
      // whole point of collapsing it.
      const filtered = factory({ status: "active" })
      expect(filtered.slice(0, base.length), name).toEqual([...base])
    }
  })

  it("lets one bare invalidation reach every filtered read in a family", () => {
    // The payor-contract table holds `payorContracts()` and
    // `payorContracts({status:"active"})` and had to invalidate both by hand.
    const qc = new QueryClient()
    qc.setQueryData(queryKeys.admin.payorContracts(), { contracts: [] })
    qc.setQueryData(queryKeys.admin.payorContracts({ status: "active" }), {
      total: 0,
    })
    expect(
      qc
        .getQueryCache()
        .findAll({ queryKey: queryKeys.admin.payorContracts() }),
    ).toHaveLength(2)
  })

  it("keys each page separately so paging is not one shared cache entry", () => {
    const qc = seeded()
    expect(
      qc.getQueryCache().findAll({
        queryKey: queryKeys.admin.vendors({ page: 9, search: "" }),
      }),
    ).toHaveLength(1)
  })
})
