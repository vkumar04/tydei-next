"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type { CreatePayorContractInput, UpdatePayorContractInput } from "@/lib/validators/payor-contracts"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

export async function createFacilityPayorContract(input: CreatePayorContractInput) {
  const session = await requireFacility()

  const contract = await prisma.payorContract.create({
    data: {
      payorName: input.payorName,
      payorType: input.payorType,
      facilityId: session.facility.id,
      contractNumber: input.contractNumber,
      effectiveDate: new Date(input.effectiveDate),
      expirationDate: new Date(input.expirationDate),
      status: input.status ?? "active",
      cptRates: JSON.parse(JSON.stringify(input.cptRates)),
      grouperRates: JSON.parse(JSON.stringify(input.grouperRates)),
      implantPassthrough: input.implantPassthrough,
      implantMarkup: input.implantMarkup,
      notes: input.notes,
      uploadedBy: session.user.id,
    },
  })

  await logAudit({
    userId: session.user.id,
    action: "payor_contract.created",
    entityType: "payorContract",
    entityId: contract.id,
    metadata: { payorName: input.payorName, cptRateCount: input.cptRates.length },
  })

  return serialize(contract)
}

export async function updateFacilityPayorContract(id: string, input: UpdatePayorContractInput) {
  const session = await requireFacility()

  const data: Record<string, unknown> = { ...input }
  if (input.effectiveDate) data.effectiveDate = new Date(input.effectiveDate)
  if (input.expirationDate) data.expirationDate = new Date(input.expirationDate)
  if (input.cptRates) data.cptRates = JSON.parse(JSON.stringify(input.cptRates))
  if (input.grouperRates) data.grouperRates = JSON.parse(JSON.stringify(input.grouperRates))

  const contract = await prisma.payorContract.update({
    where: { id, facilityId: session.facility.id },
    data,
  })

  return serialize(contract)
}

export async function deleteFacilityPayorContract(id: string) {
  const session = await requireFacility()

  await prisma.payorContract.delete({
    where: { id, facilityId: session.facility.id },
  })

  await logAudit({
    userId: session.user.id,
    action: "payor_contract.deleted",
    entityType: "payorContract",
    entityId: id,
  })
}

export async function importPayorContractRates(contractId: string, rates: { cptCode: string; description?: string; rate: number }[]) {
  const session = await requireFacility()

  const contract = await prisma.payorContract.findUniqueOrThrow({
    where: { id: contractId, facilityId: session.facility.id },
  })

  const existingRates = (contract.cptRates as { cptCode: string; rate: number }[]) ?? []
  const mergedRates = [...existingRates, ...rates]

  await prisma.payorContract.update({
    where: { id: contractId },
    data: { cptRates: JSON.parse(JSON.stringify(mergedRates)) },
  })

  return { imported: rates.length, total: mergedRates.length }
}
