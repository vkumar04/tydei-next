"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { revalidatePath } from "next/cache"

export interface MergeCategoriesInput {
  canonicalName: string
  aliasNames: string[]
}

export interface MergeCategoriesResult {
  canonicalName: string
  cogRowsUpdated: number
  pricingRowsUpdated: number
  pricingFileRowsUpdated: number
  aliasesMerged: string[]
}

/**
 * Merge several category-label aliases into one canonical name. Updates
 * COGRecord.category, ContractPricing.category, and PricingFile.category
 * across the facility's data. Idempotent — re-running with the same
 * inputs is a no-op.
 *
 * Why merge-by-rename rather than alias-table: the engine paths (market
 * share, accrual, COG aggregation) all do straight string matching on
 * `category`. Renaming in place keeps every downstream path simple and
 * avoids a lookup layer. The trade-off: aliases are forgotten after the
 * merge — future imports that arrive with the alias label need to be
 * merged again. That's acceptable for the typical workflow where price
 * files are imported a few times and then aggregated continuously.
 */
export async function mergeCategories(
  input: MergeCategoriesInput,
): Promise<MergeCategoriesResult> {
  const { facility } = await requireFacility()
  const canonical = input.canonicalName.trim()
  if (!canonical) {
    throw new Error("canonicalName cannot be empty")
  }
  const aliases = input.aliasNames
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s !== canonical)
  if (aliases.length === 0) {
    return {
      canonicalName: canonical,
      cogRowsUpdated: 0,
      pricingRowsUpdated: 0,
      pricingFileRowsUpdated: 0,
      aliasesMerged: [],
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const cog = await tx.cOGRecord.updateMany({
      where: { facilityId: facility.id, category: { in: aliases } },
      data: { category: canonical },
    })
    const pricing = await tx.contractPricing.updateMany({
      where: {
        contract: { facilityId: facility.id },
        category: { in: aliases },
      },
      data: { category: canonical },
    })
    // PricingFile rows are facility-scoped via the facilityId column.
    const pricingFile = await tx.pricingFile.updateMany({
      where: { facilityId: facility.id, category: { in: aliases } },
      data: { category: canonical },
    })
    return {
      cogRowsUpdated: cog.count,
      pricingRowsUpdated: pricing.count,
      pricingFileRowsUpdated: pricingFile.count,
    }
  })

  // Invalidate every surface that aggregates by category.
  revalidatePath("/dashboard/cog-data")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard/settings/categories")

  console.info("[mergeCategories] merged", {
    facilityId: facility.id,
    canonical,
    aliases,
    ...result,
  })

  return {
    canonicalName: canonical,
    aliasesMerged: aliases,
    ...result,
  }
}
