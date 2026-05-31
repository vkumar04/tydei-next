"use server"

/**
 * Public "Re-sync carve-out scope from pricing" server action.
 *
 * Wraps the pure `populateCarveOutTermsForContract` helper with the
 * facility auth gate. Surfaces as a manual button on contract detail
 * (future); also fires automatically inside `importContractPricing`
 * which calls the helper directly (bypassing this auth-gated entry).
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  populateCarveOutTermsForContract,
  type PopulateCarveOutResult,
} from "@/lib/contracts/populate-carveout-terms"

export async function populateCarveOutTermsFromPricing(input: {
  contractId: string
}): Promise<PopulateCarveOutResult> {
  const { facility } = await requireFacility()
  await prisma.contract.findUniqueOrThrow({
    where: contractOwnershipWhere(input.contractId, facility.id),
    select: { id: true },
  })
  return populateCarveOutTermsForContract(input.contractId)
}
