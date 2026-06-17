/**
 * The mapping-key normalization used by every CategoryMapping lookup
 * (confirmed-mapping Pass 0 in the import resolver, the Map-Categories
 * dialog, and the market-share callers). Pure and dependency-free so
 * DB-free helpers (e.g. `lib/contracts/market-share-filter.ts`) can key
 * the confirmed map identically — `normalizeCategoryKey(cogCategory)` —
 * without dragging in prisma.
 *
 * This is the case/whitespace KEY normalizer: trim, lowercase, and
 * collapse internal whitespace runs to a single space. It is distinct
 * from the canonical `canonicalizeCategoryName` in
 * `lib/contracts/category-canonical.ts`, which is additionally
 * plural/word-order-blind and exists for *matching* category names
 * across sources — not for keying the confirmed-mapping Map.
 */
export const normalizeCategoryKey = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, " ")
