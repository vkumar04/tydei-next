/**
 * Canonical product-category resolution.
 *
 * Mirrors lib/vendors/resolve.ts. Charles prod feedback 2026-04-26:
 * "When you enter a price file the categories need to be validated
 * like when you do COGs and it validates the vendor names." The
 * Market Share by Category card was showing data the contract-
 * narrowed Market share row reported missing — the underlying cause
 * was free-form category strings drifting between sources (`Ortho-
 * Extremity` vs `ortho-extremity` vs trailing whitespace).
 *
 * Strategy (cheapest → most expensive):
 *   1. Trim + exact case-insensitive match against ProductCategory.name.
 *   2. Whitespace-collapse case-insensitive match (so `"Ortho  Extremity"`
 *      collides with `"Ortho Extremity"`).
 *   3. Optional create — only when `createMissing: true` is passed.
 *      Categories are tenant-shared taxonomy; per CLAUDE.md role-model,
 *      writes to ProductCategory should normally be admin-only — but
 *      import paths legitimately need to coin new ones. We tag the
 *      `source` column so admins can audit/dedupe later.
 */
import { prisma } from "@/lib/db"

type CategoryRow = { id: string; name: string }

/**
 * The mapping-key normalization used by every CategoryMapping lookup
 * (confirmed-mapping Pass 0 here, the Map-Categories dialog, and the
 * market-share callers). Exported so non-import surfaces key the
 * confirmed map identically — `normalizeCategoryKey(cogCategory)`.
 */
export const normalizeCategoryKey = (s: string): string =>
  s.trim().toLowerCase().replace(/\s+/g, " ")

const normalize = normalizeCategoryKey

/**
 * Bug 5 (Vick 2026-06-01): COG/price files ship junk in the category
 * column — a literal "0", a numeric code, or an "N/A"-style placeholder
 * (the report screenshot showed a category named "0" holding 5.4% market
 * share). Categories are product-category NAMES, never bare numbers, so
 * treat these as uncategorized (null) rather than coining a "0" category.
 */
export function isPlaceholderCategory(s: string): boolean {
  const t = s.trim().toLowerCase()
  if (!t) return true
  // Pure number / punctuation: "0", "0.0", "123", "-", "—".
  if (/^[\d.,\s/+\-–—]+$/.test(t)) return true
  return ["n/a", "na", "none", "null", "unknown", "tbd", "n.a.", "#n/a"].includes(t)
}

/**
 * #4 (Vick 2026-05-31): load confirmed CategoryMapping rules as a lookup
 * map — normalized `cogCategory` → `contractCategory`. This is the
 * category twin of the vendor resolver's confirmed-mapping Pass 0 (#1):
 * a confirmed mapping makes "JOINT" / "CONSTRUCTS-JOINT-Hip" resolve to
 * the same canonical category as the price file's "Ortho-Joints", so the
 * COG and pricing sources stop drifting. Categories are tenant-shared
 * taxonomy (like ProductCategory), so the rules are global — no facility
 * scoping, unlike VendorNameMapping.
 */
export async function loadConfirmedCategoryMap(): Promise<Map<string, string>> {
  const rows = await prisma.categoryMapping.findMany({
    where: { isConfirmed: true, contractCategory: { not: null } },
    select: { cogCategory: true, contractCategory: true },
  })
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.contractCategory) map.set(normalize(r.cogCategory), r.contractCategory)
  }
  return map
}

/**
 * Charles 2026-06-10 ("still showing categories I mapped away"): apply the
 * confirmed mapping to a list of display names at READ time. Stored
 * `ContractTerm.categories` / ProductCategory references can hold a name
 * that was later mapped away (the retro-rewrite in remapCOGCategory only
 * reaches rows that exist when the mapping is confirmed) — surfaces that
 * render category names must pass them through this so a superseded name
 * can never be displayed. Dedupes by normalized key, first occurrence wins.
 */
export function applyConfirmedCategoryMapToNames(
  names: string[],
  confirmedMap: Map<string, string>,
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const n of names) {
    const mapped = confirmedMap.get(normalize(n)) ?? n
    const key = normalize(mapped)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(mapped)
  }
  return out
}

/**
 * 2026-06-09 prod audit: confirmed swap-pair mappings (A→B AND B→A) were
 * found in production — e.g. "instruments-ortho"→"Surgical Instrumentation"
 * alongside "surgical instrumentation"→"Instruments-Ortho". With both
 * confirmed, single-pass remapping SWAPS the two names between buckets
 * instead of merging them, and a scope that lists only one of them silently
 * loses the other's spend. Saving a mapping `from → to` therefore implies
 * the inverse rule is obsolete: delete any confirmed `to → from` so a cycle
 * can never form. Call this from EVERY writer that confirms a mapping
 * (cog-category-mapping, pricing-files import, categories confirm).
 */
export async function removeInverseCategoryMapping(
  from: string,
  to: string,
): Promise<number> {
  const res = await prisma.categoryMapping.deleteMany({
    where: {
      cogCategory: { equals: to, mode: "insensitive" },
      contractCategory: { equals: from, mode: "insensitive" },
    },
  })
  return res.count
}

/**
 * Resolve a single category name to a canonical name (the one in the
 * ProductCategory table). Returns the canonical name string, NOT the
 * id, because COGRecord.category and ContractTermProduct.category are
 * stored as strings, not FKs. Existing callers still write strings;
 * this resolver just makes sure the strings agree across imports.
 *
 * When `createMissing: true` and no match exists, creates a new
 * ProductCategory row with the trimmed input + the given source tag,
 * and returns its name (== the trimmed input). When `false`, returns
 * `null` for un-matched inputs so callers can decide (e.g. leave the
 * COG row's category column null vs invent a fragmented one).
 */
export async function resolveCategoryName(
  rawName: string | null | undefined,
  opts: {
    createMissing?: boolean
    /** Provenance tag: 'cog' | 'pricing_file' | 'contract' | 'manual'. */
    source?: string
  } = {},
): Promise<string | null> {
  const createMissing = opts.createMissing ?? false
  const trimmed = (rawName ?? "").trim()
  if (!trimmed || isPlaceholderCategory(trimmed)) return null

  // Pass 0 (#4): a confirmed category mapping wins over the
  // ProductCategory match, so mapped variants unify on every import.
  const mapped = (await loadConfirmedCategoryMap()).get(normalize(trimmed))
  if (mapped) return mapped

  const all = await prisma.productCategory.findMany({
    select: { id: true, name: true },
  })

  const matched = matchFromList(trimmed, all)
  if (matched) return matched.name

  if (!createMissing) return null

  // Create — race-tolerant
  try {
    const created = await prisma.productCategory.create({
      data: { name: trimmed, source: opts.source ?? "import" },
      select: { name: true },
    })
    return created.name
  } catch {
    // Unique-constraint race — re-query
    const found = await prisma.productCategory.findFirst({
      where: { name: { equals: trimmed, mode: "insensitive" } },
      select: { name: true },
    })
    return found?.name ?? trimmed
  }
}

/**
 * Bulk resolver. Returns a Map keyed by the lowercased+whitespace-
 * collapsed input → canonical name. Misses are omitted (caller can
 * decide null vs create).
 */
export async function resolveCategoryNamesBulk(
  rawNames: Array<string | null | undefined>,
  opts: { createMissing?: boolean; source?: string } = {},
): Promise<Map<string, string>> {
  const createMissing = opts.createMissing ?? false
  const result = new Map<string, string>()
  const unique = Array.from(
    new Set(
      rawNames
        .map((n) => (n ?? "").trim())
        // Bug 5: drop "0" / numeric / placeholder junk so it never becomes
        // a category (or maps via Pass 0). Callers leave the row null.
        .filter((n) => n && !isPlaceholderCategory(n)),
    ),
  )
  if (unique.length === 0) return result

  // Pass 0 (#4): confirmed category mappings, loaded once.
  const mappingByName = await loadConfirmedCategoryMap()

  const all = await prisma.productCategory.findMany({
    select: { id: true, name: true },
  })

  const unmatched: string[] = []
  for (const name of unique) {
    const mapped = mappingByName.get(normalize(name))
    if (mapped) {
      result.set(normalize(name), mapped)
      continue
    }
    const matched = matchFromList(name, all)
    if (matched) {
      result.set(normalize(name), matched.name)
    } else {
      unmatched.push(name)
    }
  }

  if (createMissing) {
    for (const name of unmatched) {
      try {
        const created = await prisma.productCategory.create({
          data: { name, source: opts.source ?? "import" },
          select: { name: true },
        })
        result.set(normalize(name), created.name)
      } catch {
        const found = await prisma.productCategory.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
          select: { name: true },
        })
        if (found) result.set(normalize(name), found.name)
      }
    }
  }

  return result
}

function matchFromList(
  name: string,
  rows: CategoryRow[],
): CategoryRow | null {
  const norm = normalize(name)
  // Pass 1: exact case-insensitive
  const exact = rows.find((r) => r.name.toLowerCase() === name.toLowerCase())
  if (exact) return exact
  // Pass 2: whitespace-collapse case-insensitive
  const collapsed = rows.find((r) => normalize(r.name) === norm)
  return collapsed ?? null
}
