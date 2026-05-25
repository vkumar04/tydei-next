"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"
import { serialize } from "@/lib/serialize"
import type { CategoryUsageRow } from "./types"

export async function getCategoryUsage(): Promise<CategoryUsageRow[]> {
  const { facility } = await requireFacility()
  const [cogAgg, pricingAgg] = await Promise.all([
    prisma.cOGRecord.groupBy({
      by: ["category"],
      where: { facilityId: facility.id, category: { not: null } },
      _count: { _all: true },
      _sum: { extendedPrice: true },
    }),
    prisma.contractPricing.groupBy({
      by: ["category"],
      where: { contract: { facilityId: facility.id }, category: { not: null } },
      _count: { _all: true },
    }),
  ])

  const byName = new Map<string, CategoryUsageRow>()
  for (const r of cogAgg) {
    if (!r.category) continue
    byName.set(r.category, {
      name: r.category,
      canonical: canonicalizeCategoryName(r.category),
      cogCount: r._count._all,
      cogSpend: Number(r._sum.extendedPrice ?? 0),
      pricingCount: 0,
    })
  }
  for (const r of pricingAgg) {
    if (!r.category) continue
    const existing = byName.get(r.category)
    if (existing) {
      existing.pricingCount = r._count._all
    } else {
      byName.set(r.category, {
        name: r.category,
        canonical: canonicalizeCategoryName(r.category),
        cogCount: 0,
        cogSpend: 0,
        pricingCount: r._count._all,
      })
    }
  }

  return serialize(
    Array.from(byName.values()).sort((a, b) => b.cogSpend - a.cogSpend),
  )
}
