// scripts/oracles/cog-in-term-scope.ts
/**
 * COG-in-term-scope oracle.
 *
 * Validates `buildCategoryWhereClause` and `buildUnionCategoryWhereClause`
 * against synthetic `ContractTerm`-shaped fixtures. The helpers are the
 * canonical filter for "which COG rows fall inside this term's scope"
 * (see CLAUDE.md — used by recomputeAccrualForContract,
 * getAccrualTimeline, and the contracts-list trailing-12mo cascade).
 *
 * The oracle reasons inline about the EXPECTED Prisma where-fragment
 * for each term/term-set combination and asserts the helper returns
 * the same shape. Drift in the helper would silently re-scope COG
 * filtering on production read paths — a class of bug that doesn't
 * surface until "wrong number" complaints land.
 *
 * No DB. Mock-driven. Engine-input layer.
 */
import { defineOracle } from "./_shared/runner"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
  type CategoryScopedTermLike,
} from "@/lib/contracts/cog-category-filter"

interface SingleTermCase {
  label: string
  term: CategoryScopedTermLike
  expected: { category?: { in: string[] } }
}

interface UnionCase {
  label: string
  terms: CategoryScopedTermLike[]
  expected: { category?: { in: string[] } }
}

const SINGLE_CASES: SingleTermCase[] = [
  {
    label: "all_products → empty fragment (no narrowing)",
    term: { appliesTo: "all_products", categories: ["Spine"] },
    expected: {},
  },
  {
    label: "specific_category + populated → category IN list",
    term: { appliesTo: "specific_category", categories: ["Spine", "Joint Replacement"] },
    expected: { category: { in: ["Spine", "Joint Replacement"] } },
  },
  {
    label: "specific_category + empty → empty fragment",
    term: { appliesTo: "specific_category", categories: [] },
    expected: {},
  },
  {
    label: "specific_category + null categories → empty fragment",
    term: { appliesTo: "specific_category", categories: null },
    expected: {},
  },
  {
    label: "no scope set → empty fragment",
    term: { categories: ["Spine"] },
    expected: {},
  },
  {
    label: "productScope alias accepted (treated as appliesTo)",
    term: { productScope: "specific_category", categories: ["Spine"] },
    expected: { category: { in: ["Spine"] } },
  },
  {
    label: "duplicate category names deduplicated while preserving order",
    term: {
      appliesTo: "specific_category",
      categories: ["Spine", "Joint Replacement", "Spine"],
    },
    expected: { category: { in: ["Spine", "Joint Replacement"] } },
  },
]

const UNION_CASES: UnionCase[] = [
  {
    label: "no terms → empty fragment",
    terms: [],
    expected: {},
  },
  {
    label: "any all_products term → empty fragment (widest wins)",
    terms: [
      { appliesTo: "specific_category", categories: ["Spine"] },
      { appliesTo: "all_products", categories: [] },
    ],
    expected: {},
  },
  {
    label: "every term specific_category → union of categories",
    terms: [
      { appliesTo: "specific_category", categories: ["Spine"] },
      { appliesTo: "specific_category", categories: ["Joint Replacement"] },
    ],
    expected: { category: { in: ["Spine", "Joint Replacement"] } },
  },
  {
    label: "specific_category with empty categories → empty fragment (treat as wide)",
    terms: [
      { appliesTo: "specific_category", categories: ["Spine"] },
      { appliesTo: "specific_category", categories: [] },
    ],
    expected: {},
  },
  {
    label: "overlapping category sets → deduped union",
    terms: [
      { appliesTo: "specific_category", categories: ["Spine", "Joint Replacement"] },
      { appliesTo: "specific_category", categories: ["Joint Replacement", "Trauma"] },
    ],
    expected: { category: { in: ["Spine", "Joint Replacement", "Trauma"] } },
  },
]

function arraysEqualUnordered(a: string[] | undefined, b: string[] | undefined): boolean {
  if (!a || !b) return a === b
  if (a.length !== b.length) return false
  const aSorted = [...a].sort()
  const bSorted = [...b].sort()
  return aSorted.every((x, i) => x === bSorted[i])
}

function fragmentsAgree(
  app: { category?: { in: string[] } },
  expected: { category?: { in: string[] } },
): boolean {
  // Both empty: agree.
  if (!app.category && !expected.category) return true
  if (!app.category || !expected.category) return false
  return arraysEqualUnordered(app.category.in, expected.category.in)
}

export default defineOracle("cog-in-term-scope", async (ctx) => {
  for (const c of SINGLE_CASES) {
    const got = buildCategoryWhereClause(c.term)
    ctx.check(
      `[buildCategoryWhereClause] ${c.label}`,
      fragmentsAgree(got, c.expected),
      `expected=${JSON.stringify(c.expected)} got=${JSON.stringify(got)}`,
    )
  }

  for (const c of UNION_CASES) {
    const got = buildUnionCategoryWhereClause(c.terms)
    ctx.check(
      `[buildUnionCategoryWhereClause] ${c.label}`,
      fragmentsAgree(got, c.expected),
      `expected=${JSON.stringify(c.expected)} got=${JSON.stringify(got)}`,
    )
  }
})
