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

export interface EnsureCarveOutTermResult {
  /** True iff a carve_out term was created by this call. */
  created: boolean
  /** The carve_out term id, when one exists (created or pre-existing). */
  termId: string | null
  /** Number of pricing rows on the contract with carveOutPercent > 0. */
  carveOutSkuCount: number
}

/**
 * Auto-create a `carve_out` term for a contract when its pricing file
 * carried explicit carve-out percentages but no carve_out term exists yet.
 *
 * Rationale (Charles 2026-06-07, SYK Carve out.xlsx): a pricing file with a
 * dedicated "Carve out %" column is an unambiguous signal that the contract
 * IS a carve-out contract. But carve-out math + display are gated on a
 * `carve_out` ContractTerm (getCarveOutRebate term-gate, b015fec), and
 * `populateCarveOutTermsForContract` only LINKS to an existing term — it never
 * creates one. Net effect: importing a carve-out file alone produced no
 * carve-out anywhere. This bridges that gap.
 *
 * Signal: ≥1 ContractPricing row with carveOutPercent > 0. A pure
 * spend-rebate file has no carve-out column → no such rows → no term created,
 * so the b015fec "spend contract shouldn't show a phantom carve-out" fix
 * stays intact.
 *
 * Idempotent: if any carve_out term already exists, this is a no-op (created
 * = false). Callers run `populateCarveOutTermsForContract` afterward to link
 * the SKUs (whether the term was just created or pre-existing).
 *
 * Auth is the caller's responsibility — assumes `contractId` is already
 * verified to belong to the active facility.
 */
export async function ensureCarveOutTermFromPricing(
  contractId: string,
): Promise<EnsureCarveOutTermResult> {
  const carveOutSkuCount = await prisma.contractPricing.count({
    where: { contractId, carveOutPercent: { not: null, gt: 0 } },
  })

  // No carve-out signal in the pricing file → don't create a term. This is
  // the pure-spend-rebate case; leave it untouched.
  if (carveOutSkuCount === 0) {
    return { created: false, termId: null, carveOutSkuCount: 0 }
  }

  // Idempotency: only create when the contract has no carve_out term yet.
  const existing = await prisma.contractTerm.findFirst({
    where: { contractId, termType: "carve_out" },
    select: { id: true },
  })
  if (existing) {
    return { created: false, termId: existing.id, carveOutSkuCount }
  }

  // Scope the term to the contract's own active window so date-bounded
  // readers don't reject it. Defaults mirror createContractTerm's evergreen
  // sentinels when the contract carries no dates.
  const contract = await prisma.contract.findUnique({
    where: { id: contractId },
    select: { effectiveDate: true, expirationDate: true },
  })
  const effectiveStart =
    contract?.effectiveDate ?? new Date(Date.UTC(1970, 0, 1))
  const effectiveEnd =
    contract?.expirationDate ?? new Date(Date.UTC(9999, 11, 31))

  const term = await prisma.contractTerm.create({
    data: {
      contractId,
      termName: "Carve-Out (from pricing file)",
      termType: "carve_out",
      // Carve-out math reads ContractPricing.carveOutPercent per-SKU, not
      // tiers or rebateMethod — these are display/consistency defaults only.
      // appliesTo flips to "specific_items" once SKUs are linked
      // (populateCarveOutTermsForContract).
      appliesTo: "specific_items",
      effectiveStart,
      effectiveEnd,
    },
    select: { id: true },
  })

  return { created: true, termId: term.id, carveOutSkuCount }
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
        // Flip the term's scope to "specific_items" — the value the term
        // editor UI (Product Scope dropdown + SpecificItemsPicker) and
        // scopedItemNumbers round-trip recognize. Vick 2026-05-31 (#3):
        // previously wrote the orphan value "specific_products", which no
        // dropdown option matched, so the Select rendered stale/empty.
        // Engine-neutral: carve-out rebate math reads
        // ContractPricing.carveOutPercent per-SKU
        // (lib/contracts/recompute/carve-out.ts), not appliesTo — this
        // value only drives the (now read-only) UI display.
        await tx.contractTerm.update({
          where: { id: term.id },
          data: { appliesTo: "specific_items" },
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
