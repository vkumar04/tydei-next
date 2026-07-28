"use server"

/**
 * Vendor "also known as" management.
 *
 * Charles 2026-07-27: "In settings on the vendor side, I have a company name,
 * example Stryker. How does it know on the facility side what contract to pull
 * in when multiple names are used?" The facility-side join is by `vendorId` FK
 * and is exact, so everything depends on ingestion resolving a raw name string
 * to the right vendor. These actions let a vendor declare the spellings their
 * name actually appears under in facility COG / PO / invoice files, so
 * `lib/vendors/resolve.ts` stops minting a duplicate Vendor row per spelling.
 *
 * Tenant isolation: every action resolves the vendor from the SESSION
 * (`requireVendor()`) and never from a client-supplied id, so a vendor can only
 * ever read or mutate its own aliases.
 */

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { vendorNameKey } from "@/lib/vendors/normalize"
import { VENDOR_ALIASES } from "@/lib/vendor-aliases"
import { similarityRatio } from "@/lib/vendors/similarity"
import { revalidatePath } from "next/cache"
import { z } from "zod"

const aliasInputSchema = z.object({
  alias: z.string().trim().min(2, "Alias must be at least 2 characters").max(200),
})

export interface VendorAliasRow {
  id: string
  alias: string
  normalizedAlias: string
  source: string
  createdAt: string
}

/** The calling vendor's declared aliases, newest first. */
export async function listVendorAliases(): Promise<VendorAliasRow[]> {
  const { vendor } = await requireVendor()
  const rows = await prisma.vendorAlias.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
  })
  return rows.map((r) => ({
    id: r.id,
    alias: r.alias,
    normalizedAlias: r.normalizedAlias,
    source: r.source,
    createdAt: r.createdAt.toISOString(),
  }))
}

export interface AddVendorAliasResult {
  ok: boolean
  error?: string
  alias?: VendorAliasRow
}

/**
 * Declare a new alias for the calling vendor.
 *
 * Refuses an alias already claimed by ANOTHER vendor rather than stealing it:
 * `normalizedAlias` is globally unique precisely so two companies can't both
 * claim "Howmedica Osteonics" and quietly cross-attribute each other's spend.
 */
export async function addVendorAlias(
  input: unknown,
): Promise<AddVendorAliasResult> {
  const { vendor } = await requireVendor()
  await requireCanMutate()

  const parsed = aliasInputSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid alias" }
  }
  const alias = parsed.data.alias
  const normalizedAlias = vendorNameKey(alias)

  if (!normalizedAlias) {
    return {
      ok: false,
      error:
        "That alias normalizes to nothing — it is only punctuation or corporate suffixes.",
    }
  }

  // Charles 2026-07-28: typing "Stryker" into the Stryker workspace returned
  // `"Stryker Corp" is already on your list.` — naming a string the user never
  // typed, with no hint as to why. Both collapse to the key "stryker".
  //
  // The real defect is upstream: "Stryker Corp" should never have been ADDABLE.
  // It normalizes to the vendor's own name, so resolve.ts Pass 1b already
  // resolved it and the alias row is a no-op that exists only to block the
  // genuine entry. Reject redundant aliases up front and say why, so this state
  // cannot be reached.
  const selfKeys = [vendor.name, vendor.displayName ?? ""]
    .filter(Boolean)
    .map(vendorNameKey)
    .filter(Boolean)
  if (selfKeys.includes(normalizedAlias)) {
    return {
      ok: false,
      error: `"${alias}" already resolves to ${vendor.name} on its own — case, punctuation and corporate suffixes are ignored, so no alias is needed. Add a spelling that genuinely differs, like a sales entity or an acquired brand.`,
    }
  }

  const existing = await prisma.vendorAlias.findUnique({
    where: { normalizedAlias },
    select: { id: true, vendorId: true, alias: true },
  })
  if (existing) {
    if (existing.vendorId === vendor.id) {
      // Name BOTH spellings when they differ — otherwise the message looks like
      // a non sequitur.
      return {
        ok: false,
        error:
          existing.alias.trim().toLowerCase() === alias.trim().toLowerCase()
            ? `"${alias}" is already on your list.`
            : `"${alias}" is already covered by "${existing.alias}" — both match as "${normalizedAlias}" once case, punctuation and corporate suffixes are ignored.`,
      }
    }
    return {
      ok: false,
      error: `"${alias}" is already claimed by another vendor. Contact support if that is wrong — an alias can only belong to one company.`,
    }
  }

  const created = await prisma.vendorAlias.create({
    data: { vendorId: vendor.id, alias, normalizedAlias, source: "vendor" },
  })

  revalidatePath("/vendor/settings")
  return {
    ok: true,
    alias: {
      id: created.id,
      alias: created.alias,
      normalizedAlias: created.normalizedAlias,
      source: created.source,
      createdAt: created.createdAt.toISOString(),
    },
  }
}

/** Remove one of the calling vendor's own aliases. */
export async function removeVendorAlias(
  aliasId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { vendor } = await requireVendor()
  await requireCanMutate()

  // Ownership-scoped delete: the vendorId predicate is what stops a vendor
  // deleting another vendor's alias by guessing an id.
  const res = await prisma.vendorAlias.deleteMany({
    where: { id: aliasId, vendorId: vendor.id },
  })
  if (res.count === 0) return { ok: false, error: "Alias not found." }

  revalidatePath("/vendor/settings")
  return { ok: true }
}

export interface VendorAliasSuggestion {
  /** The spelling to add, as it should be displayed. */
  alias: string
  /** Why we think it belongs to this vendor. */
  reason: string
}

/**
 * Suggested aliases for the calling vendor (Charles 2026-07-28: "There should
 * be suggestions in the Alias'").
 *
 * Two sources, both deliberately free of facility data:
 *   1. The curated alias list in lib/vendor-aliases.ts, matched to this vendor.
 *   2. Other rows in the GLOBAL Vendor catalog whose name looks like a variant
 *      of this one — those are the duplicate silos ingestion created, and they
 *      are exactly what an alias would consolidate.
 *
 * No COG/PO/invoice counts are returned. A "this alias would rescue N rows"
 * number reads well but is computed over records owned by facilities the caller
 * may have no relationship with, so it would leak another tenant's volume. The
 * Vendor catalog itself is already global — resolve.ts enumerates it for every
 * import — so naming a duplicate record discloses nothing new.
 *
 * Anything already covered (the vendor's own name, an existing alias, or a name
 * claimed by another vendor) is filtered out, so every suggestion is actionable.
 */
export async function suggestVendorAliases(): Promise<VendorAliasSuggestion[]> {
  const { vendor } = await requireVendor()

  const [mine, allVendors, claimed] = await Promise.all([
    prisma.vendorAlias.findMany({
      where: { vendorId: vendor.id },
      select: { normalizedAlias: true },
    }),
    prisma.vendor.findMany({ select: { id: true, name: true } }),
    prisma.vendorAlias.findMany({
      where: { vendorId: { not: vendor.id } },
      select: { normalizedAlias: true },
    }),
  ])

  const selfKey = vendorNameKey(vendor.name)
  const covered = new Set<string>([
    selfKey,
    vendorNameKey(vendor.displayName ?? ""),
    ...mine.map((a) => a.normalizedAlias),
    ...claimed.map((a) => a.normalizedAlias),
  ])
  covered.delete("")

  const out: VendorAliasSuggestion[] = []
  const seen = new Set<string>()
  const push = (alias: string, reason: string) => {
    const key = vendorNameKey(alias)
    if (!key || covered.has(key) || seen.has(key)) return
    seen.add(key)
    out.push({ alias, reason })
  }

  // 1. Curated list — keyed by canonical company name.
  for (const [canonical, aliases] of Object.entries(VENDOR_ALIASES)) {
    if (vendorNameKey(canonical) !== selfKey) continue
    for (const a of aliases) push(a, "Known alias for this company")
  }

  // 2. Duplicate Vendor records. Require a shared word OR high similarity, so
  //    "Stryker Sales Corp" surfaces for Stryker while unrelated companies do
  //    not. Deliberately narrower than a bare similarity threshold — a wrong
  //    suggestion invites a cross-company merge, which misattributes spend.
  const selfWords = new Set(selfKey.split(" ").filter((w) => w.length > 2))
  for (const v of allVendors) {
    if (v.id === vendor.id) continue
    const key = vendorNameKey(v.name)
    if (!key) continue
    const sharesWord = key.split(" ").some((w) => selfWords.has(w))
    if (!sharesWord && similarityRatio(key, selfKey) < 0.8) continue
    push(v.name, "A separate vendor record with a similar name — likely the same company split in two")
  }

  return out.slice(0, 8)
}
