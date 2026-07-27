/**
 * Unified vendor name → vendor ID resolution.
 *
 * Previously every caller (mass-upload's findOrCreateVendorByName,
 * cog-records' bulkImport inline block, matchCOGToContracts) had its
 * own variant with subtly different pass ordering. This module owns
 * the single canonical resolution pipeline.
 *
 * Strategy (cheapest → most expensive):
 *   0. confirmed per-facility VendorNameMapping (admin-set rule) — #1
 *   1. exact case-insensitive match against vendor.name / displayName
 *   1a. VendorAlias — the vendor's OWN declared "also known as" spellings
 *   1b. normalized-key match against vendor.name / displayName
 *   2. hardcoded alias literal (Stryker Corp → Stryker)
 *   3. fuzzy Levenshtein match (threshold 0.7)
 *   4. optional: create new vendor row
 *
 * Passes 1a/1b (Charles 2026-07-27): a vendor's real-world spellings were
 * falling all the way through to the 0.7 fuzzy pass and MISSING — "STRYKER
 * SALES CORP", "Howmedica Osteonics", "MAKO Surgical Corp" and "Stryker Flex
 * Financial" all returned null against a vendor list containing "Stryker", so
 * pass 4 silently minted a separate Vendor row for each and split the vendor's
 * spend into unrelated silos. 1a is the vendor's own declaration (managed in
 * vendor settings → Identity); 1b catches pure formatting drift ("Stryker,
 * Inc." / "STRYKER CORPORATION") without anyone having to declare anything.
 *
 * Both new passes are EXACT on the normalized key — never fuzzy. Under-matching
 * loses spend from a contract; over-matching cross-attributes one company's
 * spend to another's contract and inflates rebate accrual, which is a financial
 * error rather than a reporting gap. 1b additionally refuses to match when two
 * vendors share a normalized key, since it cannot tell which was meant.
 *
 * Pass 0 (Vick 2026-05-31 #1): when a `facilityId` is supplied, a
 * confirmed `VendorNameMapping` for that facility wins over every other
 * pass. This is what makes "map a vendor name once" stick — every future
 * COG / pricing import resolves the old name to the mapped vendor, so
 * REFs under the old and new names equate (the matcher keys on vendorId).
 * Callers without a facility (non-import lookups) omit `facilityId` and
 * Pass 0 is skipped — fully back-compat.
 */
import { prisma } from "@/lib/db"
import { matchVendorByAlias } from "@/lib/vendor-aliases"
import { vendorNameKey } from "@/lib/vendors/normalize"

// Placeholder id for records imported with no usable vendor name.
const UNKNOWN_VENDOR_ID = "unknown-vendor-placeholder"

type VendorRow = { id: string; name: string; displayName: string | null }

/**
 * Load every declared VendorAlias as `normalizedAlias` → vendorId. The table's
 * global unique index on `normalizedAlias` makes this map unambiguous by
 * construction: an alias belongs to exactly one vendor.
 */
async function loadAliasMap(): Promise<Map<string, string>> {
  const rows = await prisma.vendorAlias.findMany({
    select: { normalizedAlias: true, vendorId: true },
  })
  return new Map(rows.map((r) => [r.normalizedAlias, r.vendorId]))
}

/**
 * Load a facility's confirmed vendor-name rules as a lookup map:
 * lowercased `cogVendorName` → `mappedVendorId`. Only confirmed rows
 * with a target vendor participate.
 */
async function loadConfirmedMappings(
  facilityId: string,
): Promise<Map<string, string>> {
  const rows = await prisma.vendorNameMapping.findMany({
    where: { facilityId, isConfirmed: true, mappedVendorId: { not: null } },
    select: { cogVendorName: true, mappedVendorId: true },
  })
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.mappedVendorId) map.set(r.cogVendorName.trim().toLowerCase(), r.mappedVendorId)
  }
  return map
}

// ─── Single lookup ──────────────────────────────────────────────

/**
 * Resolve a single vendor name to an id. When `createMissing` is
 * true (default for imports), a new Vendor row is created for names
 * that can't be matched. When false, returns null instead.
 */
export async function resolveVendorId(
  name: string | null | undefined,
  opts: { createMissing?: boolean; facilityId?: string } = {},
): Promise<string | null> {
  const createMissing = opts.createMissing ?? true
  const trimmed = (name ?? "").trim()

  if (!trimmed) {
    if (!createMissing) return null
    return ensureUnknownVendor()
  }

  const [mappingByName, allVendors, aliasMap] = await Promise.all([
    opts.facilityId ? loadConfirmedMappings(opts.facilityId) : undefined,
    prisma.vendor.findMany({
      select: { id: true, name: true, displayName: true },
    }),
    loadAliasMap(),
  ])

  const matched = matchFromList(trimmed, allVendors, mappingByName, aliasMap)
  if (matched) return matched

  if (!createMissing) return null
  return createVendor(trimmed)
}

// ─── Bulk lookup ────────────────────────────────────────────────

/**
 * Resolve many names in one round trip. Returns a Map keyed by the
 * lowercased input name → vendor id. Names that couldn't be matched
 * are either created (default) or omitted from the map.
 */
export async function resolveVendorIdsBulk(
  names: string[],
  opts: { createMissing?: boolean; facilityId?: string } = {},
): Promise<Map<string, string>> {
  const createMissing = opts.createMissing ?? true
  const unique = Array.from(new Set(names.map((n) => n.trim()).filter(Boolean)))
  const result = new Map<string, string>()

  if (unique.length === 0) return result

  const [mappingByName, allVendors, aliasMap] = await Promise.all([
    opts.facilityId ? loadConfirmedMappings(opts.facilityId) : undefined,
    prisma.vendor.findMany({
      select: { id: true, name: true, displayName: true },
    }),
    loadAliasMap(),
  ])

  const unmatched: string[] = []
  for (const name of unique) {
    const id = matchFromList(name, allVendors, mappingByName, aliasMap)
    if (id) {
      result.set(name.toLowerCase(), id)
    } else {
      unmatched.push(name)
    }
  }

  if (createMissing) {
    for (const name of unmatched) {
      try {
        const created = await prisma.vendor.create({
          data: { name, displayName: name },
          select: { id: true },
        })
        result.set(name.toLowerCase(), created.id)
      } catch {
        // Unique-constraint race — look it up instead
        const found = await prisma.vendor.findFirst({
          where: { name: { equals: name, mode: "insensitive" } },
          select: { id: true },
        })
        if (found) result.set(name.toLowerCase(), found.id)
      }
    }
  }

  return result
}

// ─── Internals ──────────────────────────────────────────────────

/**
 * Three-pass matching against a pre-loaded vendor list. Shared
 * between single and bulk paths so both use the same algorithm.
 */
function matchFromList(
  name: string,
  vendors: VendorRow[],
  mappingByName?: Map<string, string>,
  aliasMap?: Map<string, string>,
): string | null {
  const lower = name.toLowerCase()

  // Pass 0: confirmed per-facility mapping wins over everything. Guard on
  // the target still existing in the vendor list so a deleted vendor
  // can't strand resolution on a dangling id.
  if (mappingByName) {
    const mapped = mappingByName.get(name.trim().toLowerCase())
    if (mapped && vendors.some((v) => v.id === mapped)) return mapped
  }

  // Pass 1: exact case-insensitive name/displayName
  const exact = vendors.find(
    (v) => v.name.toLowerCase() === lower || (v.displayName ?? "").toLowerCase() === lower,
  )
  if (exact) return exact.id

  const key = vendorNameKey(name)
  // An empty key means the name was nothing but punctuation/suffixes — it
  // must never match, or every such name would collapse onto one vendor.
  if (key) {
    // Pass 1a: the vendor's own declared alias. Same dangling-id guard as
    // pass 0 — a cascade-deleted vendor can't strand resolution.
    const aliased = aliasMap?.get(key)
    if (aliased && vendors.some((v) => v.id === aliased)) return aliased

    // Pass 1b: normalized-key match on name/displayName, for pure formatting
    // drift. Ambiguity is a REFUSAL, not a coin flip: if two vendors share a
    // key we cannot tell which the file meant, so fall through to fuzzy and
    // ultimately to a new row rather than guess and cross-attribute spend.
    const keyed = vendors.filter(
      (v) =>
        vendorNameKey(v.name) === key ||
        (v.displayName ? vendorNameKey(v.displayName) === key : false),
    )
    if (keyed.length === 1) return keyed[0].id
  }

  // Pass 2+3: hardcoded alias literal + fuzzy (0.7 inside matchVendorByAlias)
  return matchVendorByAlias(name, vendors)
}

async function createVendor(name: string): Promise<string> {
  try {
    const created = await prisma.vendor.create({
      data: { name, displayName: name },
      select: { id: true },
    })
    return created.id
  } catch {
    // Unique-constraint race
    const found = await prisma.vendor.findFirst({
      where: { name: { equals: name, mode: "insensitive" } },
      select: { id: true },
    })
    if (found) return found.id
    // Absolute fallback — should never hit
    return ensureUnknownVendor()
  }
}

async function ensureUnknownVendor(): Promise<string> {
  const fallback = await prisma.vendor.upsert({
    where: { id: UNKNOWN_VENDOR_ID },
    update: {},
    create: { id: UNKNOWN_VENDOR_ID, name: "Unknown Vendor", status: "active" },
    select: { id: true },
  })
  return fallback.id
}
