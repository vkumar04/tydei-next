import { describe, it, expect } from "vitest"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
} from "@/lib/contracts/cog-category-filter"

// Charles W1.U-A: this helper is the single place the category
// where-fragment lives. If a read path forgets to spread its return
// value into the COG findMany where, the accrual engine will see the
// vendor's entire spend and compute a category-scoped rebate at the
// wrong tier. These tests are the regression lock.
describe("buildCategoryWhereClause", () => {
  it("all-products scope returns empty fragment (no filter applied)", () => {
    // `appliesTo === "all_products"` is the default value for every
    // seeded term — returning an empty fragment keeps the vendor-wide
    // query unchanged for every non-category-scoped term.
    expect(
      buildCategoryWhereClause({ appliesTo: "all_products", categories: [] }),
    ).toEqual({})
    // Non-empty categories on an all-products term are meaningless but
    // should NOT accidentally scope the query. The scope gate wins.
    expect(
      buildCategoryWhereClause({
        appliesTo: "all_products",
        categories: ["Spine"],
      }),
    ).toEqual({})
  })

  it("specific-category with 1 category emits `category in [name]`", () => {
    // The COG.category column is free-text; matching on the exact name
    // (case-sensitive) is correct because the category picker in the
    // term entry form writes the same canonical names that COG import
    // writes into `category` — verified via DB probe: "Arthroscopy",
    // "Spine", "Joint Replacement", etc.
    expect(
      buildCategoryWhereClause({
        appliesTo: "specific_category",
        categories: ["Extremities & Trauma"],
      }),
    ).toEqual({ category: { in: ["Extremities & Trauma"] } })
  })

  it("specific-category with 3 categories emits `in [...]` (order-stable, de-duped)", () => {
    // De-duping while preserving order keeps the generated SQL stable
    // across identical inputs (query-plan cache friendly + readable in
    // tests). Duplicate entries are dropped silently.
    expect(
      buildCategoryWhereClause({
        appliesTo: "specific_category",
        categories: ["Spine", "Joint Replacement", "Arthroscopy", "Spine"],
      }),
    ).toEqual({
      category: { in: ["Spine", "Joint Replacement", "Arthroscopy"] },
    })
  })

  it("null / undefined categories return empty fragment", () => {
    // A newly-created "specific_category" term with no categories picked
    // yet shouldn't wipe the vendor's spend — that would break the UX
    // for partially-configured terms. Return a no-op fragment instead.
    expect(
      buildCategoryWhereClause({
        appliesTo: "specific_category",
        categories: null,
      }),
    ).toEqual({})
    expect(
      buildCategoryWhereClause({
        appliesTo: "specific_category",
        categories: undefined,
      }),
    ).toEqual({})
    expect(
      buildCategoryWhereClause({
        appliesTo: "specific_category",
        categories: [],
      }),
    ).toEqual({})
  })

  it("accepts `productScope` as an alias for `appliesTo`", () => {
    // Plan doc + some client surfaces call the gate field `productScope`
    // while the Prisma column is `appliesTo`. The helper accepts either.
    expect(
      buildCategoryWhereClause({
        productScope: "specific_category",
        categories: ["Spine"],
      }),
    ).toEqual({ category: { in: ["Spine"] } })
  })
})

describe("buildUnionCategoryWhereClause", () => {
  it("returns empty fragment when ANY term is all_products", () => {
    // A contract with even one "all_products" term earns rebates on the
    // entire vendor spend — we can't narrow the shared COG query or
    // rows the wide term needs will get dropped.
    expect(
      buildUnionCategoryWhereClause([
        { appliesTo: "all_products" },
        {
          appliesTo: "specific_category",
          categories: ["Spine"],
        },
      ]),
    ).toEqual({})
  })

  it("unions categories across specific-category terms", () => {
    expect(
      buildUnionCategoryWhereClause([
        {
          appliesTo: "specific_category",
          categories: ["Spine"],
        },
        {
          appliesTo: "specific_category",
          categories: ["Arthroscopy", "Spine"],
        },
      ]),
    ).toEqual({ category: { in: ["Spine", "Arthroscopy"] } })
  })

  it("empty terms list returns empty fragment", () => {
    expect(buildUnionCategoryWhereClause([])).toEqual({})
  })
})
