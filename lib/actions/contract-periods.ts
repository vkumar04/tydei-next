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

/**
 * Create a contract transaction (stored as a ContractPeriod record).
 */
export async function createContractTransaction(input: {
  contractId: string
  type: "rebate" | "credit" | "payment"
  amount: number
  description: string
  date: string
}) {
  const { facility } = await requireFacility()

  // Verify access
  await prisma.contract.findUniqueOrThrow({
    where: {
      id: input.contractId,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const periodDate = new Date(input.date)

  const period = await prisma.contractPeriod.create({
    data: {
      contractId: input.contractId,
      facilityId: facility.id,
      periodStart: periodDate,
      periodEnd: periodDate,
      totalSpend: input.type === "payment" ? input.amount : 0,
      rebateEarned: input.type === "rebate" ? input.amount : 0,
      rebateCollected: input.type === "rebate" ? input.amount : 0,
      paymentExpected: input.type === "credit" ? input.amount : 0,
      paymentActual: input.type === "credit" ? input.amount : 0,
    },
  })

  return serialize(period)
}
