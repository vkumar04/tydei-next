"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"

// ─── Get Vendor Name Mappings ───────────────────────────────────

export async function getVendorNameMappings(input: {
  isConfirmed?: boolean
  page?: number
  pageSize?: number
}) {
  await requireFacility()

  const page = input.page ?? 1
  const pageSize = input.pageSize ?? 20
  const where = input.isConfirmed !== undefined
    ? { isConfirmed: input.isConfirmed }
    : {}

  const [mappings, total] = await Promise.all([
    prisma.vendorNameMapping.findMany({
      where,
      include: { vendor: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendorNameMapping.count({ where }),
  ])

  return serialize({ mappings, total })
}

// ─── Confirm Vendor Name Mapping ────────────────────────────────

export async function confirmVendorNameMapping(
  id: string,
  mappedVendorId: string
) {
  await requireFacility()

  const vendor = await prisma.vendor.findUniqueOrThrow({
    where: { id: mappedVendorId },
    select: { name: true },
  })

  await prisma.vendorNameMapping.update({
    where: { id },
    data: {
      mappedVendorId,
      mappedVendorName: vendor.name,
      isConfirmed: true,
    },
  })
}

// ─── Create Vendor Name Mapping ─────────────────────────────────

export async function createVendorNameMapping(input: {
  cogVendorName: string
  mappedVendorId?: string
  mappedVendorName?: string
  confidenceScore?: number
}) {
  await requireFacility()

  const mapping = await prisma.vendorNameMapping.create({
    data: {
      cogVendorName: input.cogVendorName,
      mappedVendorId: input.mappedVendorId,
      mappedVendorName: input.mappedVendorName,
      confidenceScore: input.confidenceScore,
    },
  })
  return serialize(mapping)
}

// ─── Delete Mapping ─────────────────────────────────────────────

export async function deleteVendorNameMapping(id: string) {
  await requireFacility()

  await prisma.vendorNameMapping.delete({ where: { id } })
}
