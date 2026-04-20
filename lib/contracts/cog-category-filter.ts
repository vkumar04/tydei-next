/**
 * Category-scoped COG filter for rebate accrual (Charles W1.U-A).
 *
 * `ContractTerm.categories: String[]` holds category NAMES (verified via
 * direct DB probe: 0.02 of the seed uses them today, but the field is
 * live in the term-entry UI under the "Specific Category" option).
 *
 * `COGRecord.category: String?` stores the same category names as free
 * text — no FK, no separate id column. Matching on `category in […]`
 * against the raw `ContractTerm.categories` strings is correct.
 *
 * Pre-W1.U the rebate-accrual read path (`recomputeAccrualForContract`,
 * `getAccrualTimeline`, and the contracts list trailing-12mo cascade)
 * pulled COG by `vendorId` only — for a term scoped to
 * ["Extremities & Trauma"], the engine saw the vendor's ENTIRE spend.
 * This helper is the one place the category where-fragment lives; every
 * COG read that should be term-scoped threads through it.
 *
 * The plan document calls the trigger field "productScope"; the real
 * column on `ContractTerm` is `appliesTo` (the UI's values are
 * "all_products" and "specific_category"). We accept both naming
 * conventions as the input type and interpret either as the gate.
 *
 * Kept framework-free (no Prisma client import) so Vitest can exercise
 * it directly and any caller can spread the fragment into their own
 * `where` clause.
 */

/**
 * Shape of the fields this helper cares about on a `ContractTerm`-like
 * object. Accepts both `appliesTo` (the Prisma column) and `productScope`
 * (the name used in the plan and some client surfaces) so either can be
 * passed through transparently.
 */
export interface CategoryScopedTermLike {
  categories?: string[] | null | undefined
  /** Prisma column on ContractTerm. Values: "all_products" | "specific_category" | other */
  appliesTo?: string | null | undefined
  /** Alias used by some callers / plan doc. Treated interchangeably with appliesTo. */
  productScope?: string | null | undefined
}

/**
 * Prisma `where`-fragment builder. Returns a fragment that can be spread
 * into a `cOGRecord.findMany({ where: { …, …buildCategoryWhereClause(term) } })`
 * call or merged into an existing where clause.
 *
 * - When the term's scope is "specific_category" AND categories is non-empty:
 *   returns `{ category: { in: [...] } }` matching COGRecord.category
 *   against the term's list of category names (exact match, case-sensitive —
 *   matches the seed where COG.category values mirror the category picker
 *   names: "Arthroscopy", "Spine", "Joint Replacement", etc.).
 * - Otherwise (all_products / unset / empty categories): returns `{}`, which
 *   is a no-op when spread into the outer where.
 */
export function buildCategoryWhereClause(
  term: CategoryScopedTermLike,
): { category?: { in: string[] } } {
  const scope = term.appliesTo ?? term.productScope ?? null
  const categories = term.categories ?? []
  if (scope !== "specific_category") return {}
  if (categories.length === 0) return {}
  // De-dup while preserving order so the generated SQL `IN` list is stable
  // across identical inputs (helps query-plan cache + test assertions).
  const unique = Array.from(new Set(categories))
  return { category: { in: unique } }
}

/**
 * Union helper for surfaces that need ONE filter across a contract's many
 * terms (e.g. the contracts-list trailing-12mo cascade queries COG once
 * per contract, not once per term). Behavior:
 *
 * - If any term is "all_products" (or has no scope) → return `{}` because
 *   the widest term sees the full vendor spend; narrowing would lose rows.
 * - If every term is "specific_category" → return `{ category: { in: union } }`
 *   so the contract row's spend reflects only categories touched by at
 *   least one of its terms.
 * - If the terms list is empty → return `{}` (no restriction; matches
 *   the pre-W1.U behavior for term-less contracts).
 */
export function buildUnionCategoryWhereClause(
  terms: readonly CategoryScopedTermLike[],
): { category?: { in: string[] } } {
  if (terms.length === 0) return {}
  const union = new Set<string>()
  for (const t of terms) {
    const scope = t.appliesTo ?? t.productScope ?? null
    if (scope !== "specific_category") return {}
    const cats = t.categories ?? []
    // Empty categories on a "specific_category" term mean "not yet
    // configured"; treat as a full-vendor window so we don't wipe COG
    // spend for partially-configured terms.
    if (cats.length === 0) return {}
    for (const c of cats) union.add(c)
  }
  if (union.size === 0) return {}
  return { category: { in: Array.from(union) } }
}
