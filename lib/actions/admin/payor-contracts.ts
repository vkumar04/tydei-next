"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import type {
  CreatePayorContractInput,
  UpdatePayorContractInput,
  PayorContractRate,
} from "@/lib/validators/payor-contracts"

// ─── List Payor Contracts ───────────────────────────────────────

export async function getPayorContracts(input: {
  facilityId?: string
  status?: string
  page?: number
  pageSize?: number
}) {
  await requireAdmin()
  const { facilityId, status, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (facilityId) where.facilityId = facilityId
  if (status) where.status = status

  const [contracts, total] = await Promise.all([
    prisma.payorContract.findMany({
      where,
      include: { facility: { select: { name: true } } },
      orderBy: { uploadedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.payorContract.count({ where }),
  ])

  return {
    contracts: contracts.map((c) => ({
      ...c,
      effectiveDate: c.effectiveDate.toISOString(),
      expirationDate: c.expirationDate.toISOString(),
      uploadedAt: c.uploadedAt.toISOString(),
      implantMarkup: Number(c.implantMarkup),
      facilityName: c.facility.name,
    })),
    total,
  }
}

// ─── Create Payor Contract ──────────────────────────────────────

export async function createPayorContract(input: CreatePayorContractInput) {
  await requireAdmin()

  return prisma.payorContract.create({
    data: {
      payorName: input.payorName,
      payorType: input.payorType,
      facilityId: input.facilityId,
      contractNumber: input.contractNumber,
      effectiveDate: new Date(input.effectiveDate),
      expirationDate: new Date(input.expirationDate),
      status: input.status ?? "active",
      cptRates: JSON.parse(JSON.stringify(input.cptRates)),
      grouperRates: JSON.parse(JSON.stringify(input.grouperRates)),
      implantPassthrough: input.implantPassthrough,
      implantMarkup: input.implantMarkup,
      notes: input.notes,
    },
  })
}

// ─── Update Payor Contract ──────────────────────────────────────

export async function updatePayorContract(id: string, input: UpdatePayorContractInput) {
  await requireAdmin()

  const data: Record<string, unknown> = { ...input }
  if (input.effectiveDate) data.effectiveDate = new Date(input.effectiveDate)
  if (input.expirationDate) data.expirationDate = new Date(input.expirationDate)
  if (input.cptRates) data.cptRates = JSON.parse(JSON.stringify(input.cptRates))
  if (input.grouperRates) data.grouperRates = JSON.parse(JSON.stringify(input.grouperRates))

  return prisma.payorContract.update({ where: { id }, data })
}

// ─── Delete Payor Contract ──────────────────────────────────────

export async function deletePayorContract(id: string) {
  await requireAdmin()

  await prisma.payorContract.delete({ where: { id } })
}

// ─── Import CPT Rates ───────────────────────────────────────────

export async function importCPTRates(contractId: string, rates: PayorContractRate[]) {
  await requireAdmin()

  const contract = await prisma.payorContract.findUniqueOrThrow({
    where: { id: contractId },
  })

  const existingRates = (contract.cptRates as unknown as PayorContractRate[]) ?? []
  const mergedRates = [...existingRates, ...rates]

  await prisma.payorContract.update({
    where: { id: contractId },
    data: { cptRates: JSON.parse(JSON.stringify(mergedRates)) },
  })

  return { imported: rates.length }
}

// ─── Assign to Facility ─────────────────────────────────────────

export async function assignPayorContractToFacility(contractId: string, facilityId: string) {
  await requireAdmin()

  await prisma.payorContract.update({
    where: { id: contractId },
    data: { facilityId },
  })
}
