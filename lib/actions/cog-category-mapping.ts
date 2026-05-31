"use server"

/**
 * COG category mapping — the category twin of cog-vendor-mapping.ts (#1).
 *
 * Vick 2026-05-31 (#4): "When price files are loaded, especially for
 * categories, the system should do mapping for categories the same way it
 * does for vendor names with COGs." COG categories ("JOINT",
 * "CONSTRUCTS-JOINT-Hip") and the price file's ("Ortho-Joints") are
 * different names for the same thing; nothing unified them. These actions
 * let the user map them, retag existing rows, and persist a confirmed
 * CategoryMapping rule that the resolver (lib/categories/resolve.ts)
 * applies to every future import.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { revalidatePath } from "next/cache"

const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")

export interface CogCategoryMapping {
  /** The raw category string as it appears in COG/pricing rows. */
  category: string
  recordCount: number
  totalSpend: number
  /** Confirmed canonical target, if a mapping exists. */
  mappedTo: string | null
}

/**
 * Distinct COG categories at this facility + their current confirmed
 * mapping target (if any). Drives the Category Mapping dialog.
 */
export async function getCOGCategoryMappings(): Promise<CogCategoryMapping[]> {
  const { facility } = await requireFacility()

  const grouped = await prisma.cOGRecord.groupBy({
    by: ["category"],
    where: { facilityId: facility.id, category: { not: null } },
    _count: { _all: true },
    _sum: { extendedPrice: true },
  })

  const confirmed = await prisma.categoryMapping.findMany({
    where: { isConfirmed: true, contractCategory: { not: null } },
    select: { cogCategory: true, contractCategory: true },
  })
  const byName = new Map<string, string>()
  for (const m of confirmed) {
    if (m.contractCategory) byName.set(normalize(m.cogCategory), m.contractCategory)
  }

  return grouped
    .map((g) => {
      const category = (g.category ?? "").trim()
      return {
        category,
        recordCount: g._count?._all ?? 0,
        totalSpend: Number(g._sum?.extendedPrice ?? 0),
        mappedTo: byName.get(normalize(category)) ?? null,
      }
    })
    .filter((r) => r.category)
    .sort((a, b) => b.totalSpend - a.totalSpend)
}

/**
 * Map a COG category to a canonical category. Retags existing COG rows
 * (facility-scoped), upserts a confirmed CategoryMapping rule so future
 * imports auto-apply it, then recomputes match statuses for the affected
 * vendors so category-scoped contract matching reflects the change.
 * `contractCategory === null` clears the mapping (unmap).
 */
export async function remapCOGCategory(input: {
  cogCategory: string
  contractCategory: string | null
}): Promise<{ recordsUpdated: number }> {
  const { facility } = await requireFacility()
  const from = input.cogCategory.trim()
  if (!from) throw new Error("cogCategory required")
  const to = input.contractCategory?.trim() || null

  // Capture the vendors whose COG sits in this category so we can recompute
  // their match statuses after the retag (category scope can change which
  // rows are on-contract).
  const affected = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      category: { equals: from, mode: "insensitive" },
    },
    select: { vendorId: true },
    distinct: ["vendorId"],
  })
  const vendorIds = affected
    .map((r) => r.vendorId)
    .filter((v): v is string => !!v)

  let recordsUpdated = 0
  if (to) {
    const updated = await prisma.cOGRecord.updateMany({
      where: {
        facilityId: facility.id,
        category: { equals: from, mode: "insensitive" },
      },
      data: { category: to },
    })
    recordsUpdated = updated.count

    // Persist the confirmed rule (upsert on cogCategory).
    // auth-scope-scanner-skip: CategoryMapping is global taxonomy (no
    // facilityId column, same as ProductCategory) — it cannot be
    // tenant-scoped. Looked up by cogCategory; the action is gated by
    // requireFacility above.
    const existing = await prisma.categoryMapping.findFirst({
      where: { cogCategory: { equals: from, mode: "insensitive" } },
      select: { id: true },
    })
    if (existing) {
      // auth-scope-scanner-skip: CategoryMapping is global taxonomy (no
      // facilityId) — updating the row found by cogCategory above.
      await prisma.categoryMapping.update({
        where: { id: existing.id },
        data: { contractCategory: to, isConfirmed: true },
      })
    } else {
      await prisma.categoryMapping.create({
        data: { cogCategory: from, contractCategory: to, isConfirmed: true },
      })
    }
  } else {
    // Unmap — drop any rule for this category.
    await prisma.categoryMapping.deleteMany({
      where: { cogCategory: { equals: from, mode: "insensitive" } },
    })
  }

  for (const vendorId of vendorIds) {
    await recomputeMatchStatusesForVendor(vendorId, facility.id)
  }

  revalidatePath("/dashboard/cog-data")
  revalidatePath("/dashboard/contracts")
  return { recordsUpdated }
}
