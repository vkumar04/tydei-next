"use server"

/**
 * Cross-vendor category suggestions.
 *
 * Charles 2026-04-25: "When I enter a contract from another company
 * with a similar category there is not mapping coming up for that."
 * When the user picks a category on a new contract, they should see
 * how OTHER active contracts at the same facility have configured
 * the same category — what term scope (specific_category vs
 * specific_items vs all_products), what tier ladder, what
 * rebateMethod — so they don't redo the configuration from scratch
 * for every new vendor.
 *
 * v1: returns matching contracts + their first tiered term's
 * config so the form can offer "Match this setup from <vendor>"
 * suggestions. The form decides whether to one-click apply or just
 * surface as a hint.
 */
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface CategorySuggestionRow {
  contractId: string
  contractName: string
  vendorName: string
  contractType: string
  /** Matched category name from the suggestion query. */
  categoryName: string
  /** First tiered term's configuration (the most likely template). */
  templateTerm: {
    termName: string
    termType: string
    appliesTo: string
    rebateMethod: string
    evaluationPeriod: string
    paymentTiming: string
    /** Categories array on the term (specific_category scope). */
    categories: string[]
    /** Tier ladder snapshot for the form to offer "copy these tiers". */
    tiers: Array<{
      tierNumber: number
      spendMin: number
      spendMax: number | null
      rebateType: string
      /** Stored as fraction in DB (0.03 = 3%); the suggestion form
       *  is responsible for rendering it via the canonical scaler. */
      rebateValue: number
    }>
  } | null
}

export async function getCategorySuggestions(input: {
  /** The category name the user just picked on the new contract. */
  category: string
  /** Exclude contracts from this vendor (the user's current vendor). */
  excludeVendorId?: string
}): Promise<CategorySuggestionRow[]> {
  try {
    const { facility } = await requireFacility()
    if (!input.category || input.category.trim().length === 0) return []

    // Match contracts at this facility whose first tiered term has
    // `categories[]` containing the picked category. We also include
    // matches via `Contract.productCategory.name` for the legacy
    // single-category contracts.
    const baseWhere = contractsOwnedByFacility(facility.id)
    const contracts = await prisma.contract.findMany({
      where: {
        ...baseWhere,
        status: { in: ["active", "expiring"] },
        ...(input.excludeVendorId && {
          vendorId: { not: input.excludeVendorId },
        }),
        OR: [
          // Term-level scope match
          {
            terms: {
              some: {
                appliesTo: "specific_category",
                categories: { has: input.category },
              },
            },
          },
          // Contract-level productCategory match (legacy)
          { productCategory: { name: input.category } },
        ],
      },
      select: {
        id: true,
        name: true,
        contractType: true,
        vendor: { select: { name: true } },
        terms: {
          where: { tiers: { some: {} } },
          orderBy: { createdAt: "asc" },
          take: 1,
          select: {
            termName: true,
            termType: true,
            appliesTo: true,
            rebateMethod: true,
            evaluationPeriod: true,
            paymentTiming: true,
            categories: true,
            tiers: {
              orderBy: { tierNumber: "asc" },
              select: {
                tierNumber: true,
                spendMin: true,
                spendMax: true,
                rebateType: true,
                rebateValue: true,
              },
            },
          },
        },
      },
      take: 10,
    })

    const result: CategorySuggestionRow[] = contracts.map((c) => {
      const t = c.terms[0]
      return {
        contractId: c.id,
        contractName: c.name,
        vendorName: c.vendor.name,
        contractType: c.contractType,
        categoryName: input.category,
        templateTerm: t
          ? {
              termName: t.termName,
              termType: t.termType,
              appliesTo: t.appliesTo,
              rebateMethod: t.rebateMethod ?? "cumulative",
              evaluationPeriod: t.evaluationPeriod ?? "annual",
              paymentTiming: t.paymentTiming ?? "quarterly",
              categories: t.categories,
              tiers: t.tiers.map((tier) => ({
                tierNumber: tier.tierNumber,
                spendMin: Number(tier.spendMin),
                spendMax:
                  tier.spendMax === null ? null : Number(tier.spendMax),
                rebateType: tier.rebateType,
                rebateValue: Number(tier.rebateValue),
              })),
            }
          : null,
      }
    })
    return serialize(result)
  } catch (err) {
    console.error("[getCategorySuggestions]", err, {
      category: input.category,
    })
    throw err
  }
}
