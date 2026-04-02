"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  contractFiltersSchema,
  createContractSchema,
  updateContractSchema,
  type ContractFilters,
  type CreateContractInput,
  type UpdateContractInput,
} from "@/lib/validators/contracts"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"

// ─── List Contracts ──────────────────────────────────────────────

export async function getContracts(input: ContractFilters) {
  const { facility } = await requireFacility()
  const filters = contractFiltersSchema.parse(input)

  const conditions: Prisma.ContractWhereInput[] = [
    {
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
  ]

  if (filters.status) conditions.push({ status: filters.status })
  if (filters.type) conditions.push({ contractType: filters.type })
  if (filters.search) {
    conditions.push({
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { vendor: { name: { contains: filters.search, mode: "insensitive" } } },
        { contractNumber: { contains: filters.search, mode: "insensitive" } },
      ],
    })
  }

  const where: Prisma.ContractWhereInput = { AND: conditions }

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        vendor: { select: { id: true, name: true, logoUrl: true } },
        productCategory: { select: { id: true, name: true } },
        facility: { select: { id: true, name: true } },
      },
      orderBy: { updatedAt: "desc" },
      skip: ((filters.page ?? 1) - 1) * (filters.pageSize ?? 20),
      take: filters.pageSize ?? 20,
    }),
    prisma.contract.count({ where }),
  ])

  return serialize({ contracts, total })
}

// ─── Single Contract ─────────────────────────────────────────────

export async function getContract(id: string) {
  const { facility } = await requireFacility()

  const contract = await prisma.contract.findUniqueOrThrow({
    where: {
      id,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    include: {
      vendor: { select: { id: true, name: true, logoUrl: true, contactName: true, contactEmail: true } },
      productCategory: { select: { id: true, name: true } },
      terms: {
        include: { tiers: { orderBy: { tierNumber: "asc" } } },
        orderBy: { createdAt: "asc" },
      },
      documents: { orderBy: { uploadDate: "desc" } },
      contractFacilities: {
        include: { facility: { select: { id: true, name: true } } },
      },
      createdBy: { select: { id: true, name: true } },
    },
  })

  return serialize(contract)
}

// ─── Contract Stats ──────────────────────────────────────────────

export async function getContractStats() {
  const { facility } = await requireFacility()

  const where: Prisma.ContractWhereInput = {
    OR: [
      { facilityId: facility.id },
      { contractFacilities: { some: { facilityId: facility.id } } },
    ],
  }

  const [totalContracts, aggregates] = await Promise.all([
    prisma.contract.count({ where }),
    prisma.contract.aggregate({
      where,
      _sum: { totalValue: true, annualValue: true },
    }),
  ])

  const rebateResult = await prisma.rebate.aggregate({
    where: { facilityId: facility.id },
    _sum: { rebateEarned: true },
  })

  return serialize({
    totalContracts,
    totalValue: Number(aggregates._sum.totalValue ?? 0),
    totalRebates: Number(rebateResult._sum?.rebateEarned ?? 0),
  })
}

// ─── Create Contract ─────────────────────────────────────────────

export async function createContract(input: CreateContractInput) {
  const session = await requireFacility()
  const data = createContractSchema.parse(input)

  const contract = await prisma.contract.create({
    data: {
      name: data.name,
      contractNumber: data.contractNumber,
      vendorId: data.vendorId,
      facilityId: session.facility.id,
      productCategoryId: data.productCategoryId,
      contractType: data.contractType,
      status: data.status,
      effectiveDate: new Date(data.effectiveDate),
      expirationDate: new Date(data.expirationDate),
      autoRenewal: data.autoRenewal,
      terminationNoticeDays: data.terminationNoticeDays,
      totalValue: data.totalValue,
      annualValue: data.annualValue,
      description: data.description,
      notes: data.notes,
      gpoAffiliation: data.gpoAffiliation,
      performancePeriod: data.performancePeriod,
      rebatePayPeriod: data.rebatePayPeriod,
      isMultiFacility: data.isMultiFacility,
      createdById: session.user.id,
      ...(data.facilityIds.length > 0 && {
        isMultiFacility: true,
        contractFacilities: {
          create: data.facilityIds.map((fId) => ({ facilityId: fId })),
        },
      }),
    },
  })

  await logAudit({
    userId: session.user.id,
    action: "contract.created",
    entityType: "contract",
    entityId: contract.id,
    metadata: { name: data.name, vendorId: data.vendorId },
  })

  return serialize(contract)
}

// ─── Update Contract ─────────────────────────────────────────────

export async function updateContract(id: string, input: UpdateContractInput) {
  const session = await requireFacility()
  const { facility } = session
  const data = updateContractSchema.parse(input)

  // Verify ownership before updating
  await prisma.contract.findUniqueOrThrow({
    where: {
      id,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  const updateData: Prisma.ContractUpdateInput = {}

  if (data.name !== undefined) updateData.name = data.name
  if (data.contractNumber !== undefined) updateData.contractNumber = data.contractNumber
  if (data.vendorId !== undefined) updateData.vendor = { connect: { id: data.vendorId } }
  if (data.productCategoryId !== undefined) updateData.productCategory = { connect: { id: data.productCategoryId } }
  if (data.contractType !== undefined) updateData.contractType = data.contractType
  if (data.status !== undefined) updateData.status = data.status
  if (data.effectiveDate !== undefined) updateData.effectiveDate = new Date(data.effectiveDate)
  if (data.expirationDate !== undefined) updateData.expirationDate = new Date(data.expirationDate)
  if (data.autoRenewal !== undefined) updateData.autoRenewal = data.autoRenewal
  if (data.terminationNoticeDays !== undefined) updateData.terminationNoticeDays = data.terminationNoticeDays
  if (data.totalValue !== undefined) updateData.totalValue = data.totalValue
  if (data.annualValue !== undefined) updateData.annualValue = data.annualValue
  if (data.description !== undefined) updateData.description = data.description
  if (data.notes !== undefined) updateData.notes = data.notes
  if (data.gpoAffiliation !== undefined) updateData.gpoAffiliation = data.gpoAffiliation
  if (data.performancePeriod !== undefined) updateData.performancePeriod = data.performancePeriod
  if (data.rebatePayPeriod !== undefined) updateData.rebatePayPeriod = data.rebatePayPeriod
  if (data.isMultiFacility !== undefined) updateData.isMultiFacility = data.isMultiFacility

  if (data.facilityIds !== undefined) {
    await prisma.contractFacility.deleteMany({ where: { contractId: id } })
    if (data.facilityIds.length > 0) {
      updateData.isMultiFacility = true
      await prisma.contractFacility.createMany({
        data: data.facilityIds.map((fId) => ({ contractId: id, facilityId: fId })),
      })
    }
  }

  const contract = await prisma.contract.update({
    where: { id },
    data: updateData,
  })

  await logAudit({
    userId: session.user.id,
    action: "contract.updated",
    entityType: "contract",
    entityId: id,
    metadata: { updatedFields: Object.keys(updateData) },
  })

  return serialize(contract)
}

// ─── Create Contract Document ───────────────────────────────────

export async function createContractDocument(input: {
  contractId: string
  name: string
  type?: string
  url?: string
}) {
  await requireFacility()
  return prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      type: (input.type as any) ?? "main",
      url: input.url,
    },
  })
}

// ─── Delete Contract ─────────────────────────────────────────────

export async function deleteContract(id: string) {
  const session = await requireFacility()
  const { facility } = session

  // Verify ownership before deleting
  await prisma.contract.findUniqueOrThrow({
    where: {
      id,
      OR: [
        { facilityId: facility.id },
        { contractFacilities: { some: { facilityId: facility.id } } },
      ],
    },
    select: { id: true },
  })

  await prisma.contract.delete({ where: { id } })

  await logAudit({
    userId: session.user.id,
    action: "contract.deleted",
    entityType: "contract",
    entityId: id,
  })
}
