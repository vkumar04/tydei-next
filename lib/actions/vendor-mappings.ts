"use server"

import { prisma } from "@/lib/db"
import { requireAdmin, requireFacility } from "@/lib/actions/auth"
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
  // Charles audit deferred-fix: VendorNameMapping is global taxonomy.
  // Confirming a mapping changes how every facility's COG imports
  // resolve that vendor name. Admin-only. createVendorNameMapping
  // stays facility-accessible (the COG import flow needs to add new
  // mappings on the fly).
  await requireAdmin()

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
  // Charles audit deferred-fix: deleting a mapping reverts all
  // future COG imports across every facility. Admin-only.
  await requireAdmin()

  await prisma.vendorNameMapping.delete({ where: { id } })
}
