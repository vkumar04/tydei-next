/**
 * Carve-out term auto-populate from pricing file (pure helper).
 *
 * Sits behind two callers:
 *   1. `importContractPricing` (server action) — fires automatically
 *      after every pricing import.
 *   2. `populateCarveOutTermsFromPricing` (server action) — manual
 *      re-trigger button on the contract detail page.
 *
 * Auth is the caller's responsibility. This module assumes the
 * `contractId` has already been verified to belong to the active
 * facility. Don't export from a "use server" file directly.
 */

import { prisma } from "@/lib/db"

export interface PopulateCarveOutResult {
  /** Number of carve_out terms found on the contract. */
  termsFound: number
  /** Total ContractTermProduct rows created across all carve_out terms. */
  productsLinked: number
  /** SKUs in the pricing file that had carve_out > 0 (input to this op). */
  carveOutSkuCount: number
}

export async function populateCarveOutTermsForContract(
  contractId: string,
): Promise<PopulateCarveOutResult> {
  const terms = await prisma.contractTerm.findMany({
    where: { contractId, termType: "carve_out" },
    select: { id: true },
  })

  if (terms.length === 0) {
    return { termsFound: 0, productsLinked: 0, carveOutSkuCount: 0 }
  }

  const carveOutRows = await prisma.contractPricing.findMany({
    where: {
      contractId,
      carveOutPercent: { not: null, gt: 0 },
    },
    select: {
      vendorItemNo: true,
      description: true,
      unitPrice: true,
    },
  })

  if (carveOutRows.length === 0) {
    // Pricing file had no carve-out flags — nothing to link. Don't
    // wipe whatever the user manually configured before.
    return {
      termsFound: terms.length,
      productsLinked: 0,
      carveOutSkuCount: 0,
    }
  }

  let totalLinked = 0
  const BATCH = 1000
  for (const term of terms) {
    await prisma.$transaction(
      async (tx) => {
        await tx.contractTermProduct.deleteMany({
          where: { termId: term.id },
        })
        for (let i = 0; i < carveOutRows.length; i += BATCH) {
          const batch = carveOutRows.slice(i, i + BATCH)
          const result = await tx.contractTermProduct.createMany({
            data: batch.map((p) => ({
              termId: term.id,
              vendorItemNo: p.vendorItemNo,
              productDescription: p.description ?? null,
              contractPrice: p.unitPrice,
            })),
          })
          totalLinked += result.count
        }
        // Flip the term's scope so the engine reads
        // ContractTermProduct.vendorItemNo (specific_products) instead
        // of broadcasting the carve-out math across the whole catalog.
        await tx.contractTerm.update({
          where: { id: term.id },
          data: { appliesTo: "specific_products" },
        })
      },
      { maxWait: 30_000, timeout: 120_000 },
    )
  }

  return {
    termsFound: terms.length,
    productsLinked: totalLinked,
    carveOutSkuCount: carveOutRows.length,
  }
}
