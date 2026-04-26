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

const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, " ")

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
  if (!trimmed) return null

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
        .filter(Boolean),
    ),
  )
  if (unique.length === 0) return result

  const all = await prisma.productCategory.findMany({
    select: { id: true, name: true },
  })

  const unmatched: string[] = []
  for (const name of unique) {
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
