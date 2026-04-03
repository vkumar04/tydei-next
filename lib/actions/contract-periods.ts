"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

/**
 * Fetch all contract periods for a given contract, ordered by periodStart desc.
 * Used by the Contract Transactions ledger component.
 */
export async function getContractPeriods(contractId: string) {
  const { facility } = await requireFacility()

  // Verify the user has access to this contract
  await prisma.contract.findUniqueOrThrow({
    where: {
      id: contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const periods = await prisma.contractPeriod.findMany({
    where: { contractId },
    orderBy: { periodStart: "desc" },
  })

  return serialize(periods)
}
