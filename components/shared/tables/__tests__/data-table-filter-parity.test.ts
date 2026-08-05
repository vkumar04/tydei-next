import { describe, expect, it } from "vitest"
import { constructTable } from "@tanstack/react-table"
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings"
import {
  dataTableFeatures,
  filterFnForVariant,
} from "@/components/shared/tables/table-features"
import type { ColumnDef } from "@/components/shared/tables/table-features"

// Headless construction needs an explicit reactivity binding — inside the
// app, useTable injects the React one; tests use the vanilla store binding.
const testFeatures = {
  ...dataTableFeatures,
  coreReactivityFeature: storeReactivityBindings(),
}

/**
 * v8 → v9 filter parity, applied through the REAL filtered row model.
 *
 * The upgrade review (2026-08-05) caught that v9's built-in
 * `filterFn_arrIncludesSome` only matches ARRAY cell values, silently turning
 * every scalar-string select filter in the app into "No results found" — and
 * that no test anywhere APPLIED a column filter (existing tests only pinned
 * facet vocabulary). These tests construct a table with the app's actual
 * feature registration and assert row output for each filter variant.
 */

interface Row {
  vendor: string
  price: number
  tags: string[]
}

const DATA: Row[] = [
  { vendor: "Stryker", price: 100, tags: ["ortho", "capital"] },
  { vendor: "Stryker", price: 250, tags: ["ortho"] },
  { vendor: "Medtronic", price: 900, tags: ["spine"] },
]

const COLUMNS: ColumnDef<Row>[] = [
  {
    accessorKey: "vendor",
    id: "vendor",
    filterFn: filterFnForVariant("select"),
    meta: { filterVariant: "select" },
  },
  {
    accessorKey: "price",
    id: "price",
    filterFn: filterFnForVariant("range"),
    meta: { filterVariant: "range" },
  },
  {
    accessorKey: "tags",
    id: "tags",
    filterFn: filterFnForVariant("select"),
    meta: { filterVariant: "select" },
  },
]

function makeTable() {
  return constructTable({
    features: testFeatures,
    columns: COLUMNS,
    data: DATA,
  })
}

function filteredVendors(
  table: ReturnType<typeof makeTable>,
): string[] {
  return table.getFilteredRowModel().rows.map((r) => r.original.vendor)
}

describe("DataTable filter parity (v9)", () => {
  it("select filter matches SCALAR string cells (the v9 arrIncludesSome regression)", () => {
    const table = makeTable()
    table.setColumnFilters([{ id: "vendor", value: ["Stryker"] }])
    expect(filteredVendors(table)).toEqual(["Stryker", "Stryker"])
  })

  it("select filter still matches ARRAY cells", () => {
    const table = makeTable()
    table.setColumnFilters([{ id: "tags", value: ["spine"] }])
    expect(filteredVendors(table)).toEqual(["Medtronic"])
  })

  it("selecting every facet value keeps every row", () => {
    const table = makeTable()
    table.setColumnFilters([{ id: "vendor", value: ["Stryker", "Medtronic"] }])
    expect(filteredVendors(table)).toHaveLength(3)
  })

  it("range filter narrows numerically", () => {
    const table = makeTable()
    table.setColumnFilters([{ id: "price", value: [200, 1000] }])
    expect(filteredVendors(table)).toEqual(["Stryker", "Medtronic"])
  })

  it("text (default) variant matches substrings case-insensitively", () => {
    const table = makeTable()
    const withTextFilter = constructTable({
      features: testFeatures,
      columns: [
        {
          accessorKey: "vendor",
          id: "vendor",
          filterFn: filterFnForVariant("text"),
        } satisfies ColumnDef<Row>,
      ] as ColumnDef<Row>[],
      data: DATA,
    })
    withTextFilter.setColumnFilters([{ id: "vendor", value: "medtr" }])
    expect(
      withTextFilter.getFilteredRowModel().rows.map((r) => r.original.vendor),
    ).toEqual(["Medtronic"])
    expect(table.getFilteredRowModel().rows).toHaveLength(3)
  })

  it("'auto' sorting resolves from the registered sortFns registry", () => {
    const table = makeTable()
    table.setSorting([{ id: "price", desc: true }])
    expect(
      table.getSortedRowModel().rows.map((r) => r.original.price),
    ).toEqual([900, 250, 100])
  })

  it("clearing a select filter restores every row (autoRemove on empty)", () => {
    const table = makeTable()
    table.setColumnFilters([{ id: "vendor", value: ["Stryker"] }])
    expect(filteredVendors(table)).toHaveLength(2)
    table.setColumnFilters([{ id: "vendor", value: [] }])
    expect(filteredVendors(table)).toHaveLength(3)
  })
})
