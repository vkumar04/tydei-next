import { describe, expect, it } from "vitest"
import { constructTable } from "@tanstack/react-table"
import { storeReactivityBindings } from "@tanstack/table-core/store-reactivity-bindings"
import { dataTableFeatures, sortingEnabledFor } from "@/components/shared/tables/table-features"
import type { ColumnDef } from "@/components/shared/tables/table-features"

const testFeatures = {
  ...dataTableFeatures,
  coreReactivityFeature: storeReactivityBindings(),
}

interface Row {
  description: string
}

const COLUMNS: ColumnDef<Row>[] = [{ accessorKey: "description", header: "Description" }]

function build(data: Row[], enableSorting?: boolean) {
  return constructTable({
    features: testFeatures,
    data,
    columns: COLUMNS,
    ...(enableSorting === undefined ? {} : { enableSorting }),
  })
}

function clickHeader(table: ReturnType<typeof build>) {
  const column = table.getColumn("description")!
  column.getToggleSortingHandler()?.({})
  return column.getIsSorted()
}

describe("DataTable sorting while rows are loading", () => {
  it("without the guard, an empty table sorts a text column descending on first click", () => {
    expect(clickHeader(build([]))).toBe("desc")
  })

  it("the guard disables sorting while there are no rows", () => {
    const table = build([], sortingEnabledFor(0))
    expect(table.getColumn("description")!.getCanSort()).toBe(false)
    expect(clickHeader(table)).toBe(false)
  })

  it("once rows are present, a text column sorts ascending on first click", () => {
    const rows = [{ description: "Triathlon Total Knee" }, { description: "Accolade II Hip Stem" }]
    expect(sortingEnabledFor(rows.length)).toBe(true)
    expect(clickHeader(build(rows, sortingEnabledFor(rows.length)))).toBe("asc")
  })
})
