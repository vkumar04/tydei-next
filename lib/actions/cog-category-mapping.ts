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
 * Distinct categories at this facility + their current confirmed mapping
 * target (if any). Drives the Category Mapping dialog.
 *
 * Bug 1/10 (Vick 2026-06-02): "when you upload a price file it needs to map
 * categories ... like Cogs." The dialog previously listed only COGRecord
 * categories, so a category that lives only in a price file
 * (`ContractPricing.category`, e.g. "Joints-Ortho") never showed up to be
 * mapped. Union both sources so the price-file flow gets the same
 * category-value mapping COG has. CategoryMapping is global, so a rule made
 * here applies to every future COG AND price-file import via the resolver.
 */
export async function getCOGCategoryMappings(): Promise<CogCategoryMapping[]> {
  const { facility } = await requireFacility()

  const [cogGrouped, pricingGrouped] = await Promise.all([
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: { facilityId: facility.id, category: { not: null } },
      _count: { _all: true },
      _sum: { extendedPrice: true },
    }),
    prisma.contractPricing.groupBy({
      by: ["category"],
      where: { category: { not: null }, contract: { facilityId: facility.id } },
      _count: { _all: true },
    }),
  ])

  const confirmed = await prisma.categoryMapping.findMany({
    where: { isConfirmed: true, contractCategory: { not: null } },
    select: { cogCategory: true, contractCategory: true },
  })
  const byName = new Map<string, string>()
  for (const m of confirmed) {
    if (m.contractCategory) byName.set(normalize(m.cogCategory), m.contractCategory)
  }

  // Merge COG + price-file categories keyed by normalized name; keep the
  // first-seen display label and sum record counts. Price-file rows carry
  // no spend (ContractPricing is a price list, not purchases), so spend
  // comes from COG only.
  const merged = new Map<
    string,
    { category: string; recordCount: number; totalSpend: number }
  >()
  const add = (raw: string | null, count: number, spend: number) => {
    const category = (raw ?? "").trim()
    if (!category) return
    const key = normalize(category)
    const cur = merged.get(key) ?? { category, recordCount: 0, totalSpend: 0 }
    cur.recordCount += count
    cur.totalSpend += spend
    merged.set(key, cur)
  }
  for (const g of cogGrouped) {
    add(g.category, g._count?._all ?? 0, Number(g._sum?.extendedPrice ?? 0))
  }
  for (const g of pricingGrouped) {
    add(g.category, g._count?._all ?? 0, 0)
  }

  return Array.from(merged.values())
    .map((r) => ({ ...r, mappedTo: byName.get(normalize(r.category)) ?? null }))
    .sort((a, b) => b.totalSpend - a.totalSpend || b.recordCount - a.recordCount)
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

    // Bug 1/10: retag matching price-file rows too, so the contract's
    // pricing categories line up with COG immediately (not just on the
    // next import). Scoped to this facility via the contract relation.
    await prisma.contractPricing.updateMany({
      where: {
        category: { equals: from, mode: "insensitive" },
        contract: { facilityId: facility.id },
      },
      data: { category: to },
    })

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
