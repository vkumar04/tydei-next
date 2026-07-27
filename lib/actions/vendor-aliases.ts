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

  const existing = await prisma.vendorAlias.findUnique({
    where: { normalizedAlias },
    select: { id: true, vendorId: true, alias: true },
  })
  if (existing) {
    if (existing.vendorId === vendor.id) {
      return { ok: false, error: `"${existing.alias}" is already on your list.` }
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

/**
 * How many facility-side records each alias would currently rescue — the
 * "is this worth adding" number shown next to the input.
 *
 * Counts COG rows whose raw vendor name normalizes to an alias key but which
 * are attributed to a DIFFERENT vendor id than the caller's (i.e. rows that
 * landed in a duplicate silo). Read-only and vendor-scoped.
 */
export async function countRowsMatchingAlias(
  candidate: string,
): Promise<{ normalized: string; cogRows: number; conflictingVendor: string | null }> {
  const { vendor } = await requireVendor()
  const normalized = vendorNameKey(candidate)
  if (!normalized) return { normalized: "", cogRows: 0, conflictingVendor: null }

  // Vendor rows whose own name collapses to the same key — these are the
  // duplicate silos the alias would consolidate.
  const candidates = await prisma.vendor.findMany({
    select: { id: true, name: true },
  })
  const dupes = candidates.filter(
    (v) => v.id !== vendor.id && vendorNameKey(v.name) === normalized,
  )
  if (dupes.length === 0) {
    return { normalized, cogRows: 0, conflictingVendor: null }
  }

  const cogRows = await prisma.cOGRecord.count({
    where: { vendorId: { in: dupes.map((d) => d.id) } },
  })
  return { normalized, cogRows, conflictingVendor: dupes[0]?.name ?? null }
}
