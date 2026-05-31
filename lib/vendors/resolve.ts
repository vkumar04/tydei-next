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
 *   2. alias table resolution (Stryker Corp → Stryker)
 *   3. fuzzy Levenshtein match (threshold 0.7)
 *   4. optional: create new vendor row
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

// Placeholder id for records imported with no usable vendor name.
const UNKNOWN_VENDOR_ID = "unknown-vendor-placeholder"

type VendorRow = { id: string; name: string; displayName: string | null }

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

  const mappingByName = opts.facilityId
    ? await loadConfirmedMappings(opts.facilityId)
    : undefined

  const allVendors = await prisma.vendor.findMany({
    select: { id: true, name: true, displayName: true },
  })

  const matched = matchFromList(trimmed, allVendors, mappingByName)
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

  const mappingByName = opts.facilityId
    ? await loadConfirmedMappings(opts.facilityId)
    : undefined

  const allVendors = await prisma.vendor.findMany({
    select: { id: true, name: true, displayName: true },
  })

  const unmatched: string[] = []
  for (const name of unique) {
    const id = matchFromList(name, allVendors, mappingByName)
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

  // Pass 2+3: alias + fuzzy (threshold 0.7 inside matchVendorByAlias)
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
