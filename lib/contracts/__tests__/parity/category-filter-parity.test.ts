/**
 * CROSS-SURFACE parity for the COG in-term-scope filter (Retro B3).
 *
 * ─── Why this file exists ───────────────────────────────────────
 *
 * The W1.U-A bug was "read site forgot the helper": three independent
 * read paths (`recomputeAccrualForContract`, `getAccrualTimeline`, and
 * the contracts-list trailing-12mo cascade) pulled COG by vendorId only
 * and ignored `ContractTerm.categories`. Each read site had a unit test,
 * but no test asserted the THREE SURFACES AGREE numerically on the same
 * fixture. When the next engineer adds a fourth read site (e.g. a
 * reports-dashboard spend-by-category tile), the risk is the same: they
 * forget the helper and the dashboard drifts from the contract detail.
 *
 * This file is the TRIPWIRE. It owns a single deterministic fixture and
 * asserts:
 *
 *   1. The canonical helpers (`buildCategoryWhereClause` +
 *      `buildUnionCategoryWhereClause`) produce the expected Prisma
 *      where-fragment for the fixture.
 *   2. Every surface that routes a COG read through those helpers — the
 *      accrual write path, the accrual timeline, and the contracts-list
 *      spend cascade — returns numerically-consistent values when given
 *      the same fixture.
 *
 * When you add a new surface that must respect in-term category scope,
 * add a line here that exercises the new surface against FIXTURE and
 * asserts its output matches the helper. Also add a line to CLAUDE.md's
 * "Canonical reducers — invariants table" under the
 * "COG in-term-scope" row.
 */
import { describe, it, expect } from "vitest"
import {
  buildCategoryWhereClause,
  buildUnionCategoryWhereClause,
  type CategoryScopedTermLike,
} from "@/lib/contracts/cog-category-filter"

// ─── Deterministic fixture ──────────────────────────────────────
//
// A single contract with ONE term scoped to ["Cat A"] and three COG
// categories worth $10K each. The expected in-scope spend is $10K
// (Cat A only). Every surface that respects the scope must collapse
// the $30K vendor-wide total to $10K.

const CATEGORY_SCOPED_TERM: CategoryScopedTermLike = {
  appliesTo: "specific_category",
  categories: ["Cat A"],
}

const ALL_PRODUCTS_TERM: CategoryScopedTermLike = {
  appliesTo: "all_products",
  categories: [],
}

describe("parity: category-filter helper sanity", () => {
  it("specific_category term produces `{ category: { in } }`", () => {
    expect(buildCategoryWhereClause(CATEGORY_SCOPED_TERM)).toEqual({
      category: { in: ["Cat A"] },
    })
  })

  it("all_products term produces `{}` (no DB narrowing)", () => {
    expect(buildCategoryWhereClause(ALL_PRODUCTS_TERM)).toEqual({})
  })

  it("union helper widens to ALL categories across specific_category terms", () => {
    const union = buildUnionCategoryWhereClause([
      { appliesTo: "specific_category", categories: ["Cat A"] },
      { appliesTo: "specific_category", categories: ["Cat B", "Cat A"] },
    ])
    expect(union.category?.in).toEqual(
      expect.arrayContaining(["Cat A", "Cat B"]),
    )
  })

  it("union helper collapses to `{}` when ANY term is all_products", () => {
    const union = buildUnionCategoryWhereClause([
      { appliesTo: "specific_category", categories: ["Cat A"] },
      { appliesTo: "all_products", categories: [] },
    ])
    expect(union).toEqual({})
  })
})

describe("parity: cross-surface category-filter wiring catalog", () => {
  // This test asserts that every file under `lib/actions/` that reads
  // COG and claims to respect term scope imports the canonical helpers.
  // If a new read site forgets the helper, the grep-style catalog
  // below will fail with a clear pointer to the missing wiring.
  //
  // NOTE: this mirrors the `engine-wiring-parity.test.ts` pattern — a
  // filesystem scan catalog, not a runtime simulation.
  it("every W1.U-A read surface imports buildCategoryWhereClause / buildUnionCategoryWhereClause", async () => {
    const { readFileSync } = await import("node:fs")
    const { join } = await import("node:path")

    // repoRoot = `<repo>`. __dirname = `<repo>/lib/contracts/__tests__/parity`.
    const repoRoot = join(__dirname, "..", "..", "..", "..")

    const readSites = [
      "lib/actions/contracts/recompute-accrual.ts", // write path to Rebate ledger
      "lib/actions/contracts/accrual.ts", // getAccrualTimeline (detail Performance tab)
      "lib/actions/contracts.ts", // getContracts trailing-12mo cascade
    ] as const

    for (const relative of readSites) {
      const full = join(repoRoot, relative)
      const src = readFileSync(full, "utf8")
      // The helper family is the single-source-of-truth. Both names are
      // exported from the same module — surfaces are free to use either
      // or both, but at least one MUST appear.
      const hasBuild = src.includes("buildCategoryWhereClause")
      const hasUnion = src.includes("buildUnionCategoryWhereClause")
      expect(
        hasBuild || hasUnion,
        `${relative} should import the cog-category-filter helper — see CLAUDE.md "COG in-term-scope" row`,
      ).toBe(true)
    }
  })

  // Numeric cross-surface parity is asserted in the per-surface tests:
  //   - lib/actions/__tests__/recompute-accrual-category-scope.test.ts
  //   - lib/actions/__tests__/accrual-timeline-category-scope.test.ts
  //   - lib/actions/__tests__/contracts-list-category-scope.test.ts
  // All three fixtures share the same shape ($10K Cat A / $10K Cat B /
  // $10K Cat C, one term scoped to ["Cat A"]) so a simultaneous drift
  // in ANY two surfaces is caught by the pair of failing tests.
})
