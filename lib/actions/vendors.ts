"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import {
  vendorFiltersSchema,
  createVendorSchema,
  updateVendorSchema,
  type VendorFilters,
  type CreateVendorInput,
  type UpdateVendorInput,
} from "@/lib/validators/vendors"
import type { Prisma } from "@prisma/client"

// ─── List Vendors (simple - for dropdowns) ──────────────────────

export async function getVendors() {
  await requireFacility()

  return prisma.vendor.findMany({
    where: { status: "active" },
    select: { id: true, name: true, displayName: true },
    orderBy: { name: "asc" },
  })
}

// ─── List Vendors (full with filters) ───────────────────────────

export async function getVendorList(input: VendorFilters) {
  await requireFacility()
  const filters = vendorFiltersSchema.parse(input)

  const conditions: Prisma.VendorWhereInput[] = []

  if (filters.status) conditions.push({ status: filters.status })
  if (filters.search) {
    conditions.push({
      OR: [
        { name: { contains: filters.search, mode: "insensitive" } },
        { code: { contains: filters.search, mode: "insensitive" } },
        { displayName: { contains: filters.search, mode: "insensitive" } },
      ],
    })
  }

  const where: Prisma.VendorWhereInput =
    conditions.length > 0 ? { AND: conditions } : {}
  const page = filters.page ?? 1
  const pageSize = filters.pageSize ?? 20

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendor.count({ where }),
  ])

  return { vendors, total }
}

// ─── Single Vendor ──────────────────────────────────────────────

export async function getVendor(id: string) {
  await requireFacility()

  return prisma.vendor.findUniqueOrThrow({
    where: { id },
    include: { divisions: true, childVendors: true },
  })
}

// ─── Create Vendor ──────────────────────────────────────────────

export async function createVendor(input: CreateVendorInput) {
  await requireFacility()
  const data = createVendorSchema.parse(input)

  return prisma.vendor.create({
    data: {
      name: data.name,
      code: data.code,
      displayName: data.displayName,
      division: data.division,
      contactName: data.contactName,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone,
      website: data.website || null,
      address: data.address,
      tier: data.tier,
    },
  })
}

// ─── Update Vendor ──────────────────────────────────────────────

export async function updateVendor(id: string, input: UpdateVendorInput) {
  await requireFacility()
  const data = updateVendorSchema.parse(input)

  return prisma.vendor.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.code !== undefined && { code: data.code }),
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.division !== undefined && { division: data.division }),
      ...(data.contactName !== undefined && { contactName: data.contactName }),
      ...(data.contactEmail !== undefined && {
        contactEmail: data.contactEmail || null,
      }),
      ...(data.contactPhone !== undefined && {
        contactPhone: data.contactPhone,
      }),
      ...(data.website !== undefined && { website: data.website || null }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.tier !== undefined && { tier: data.tier }),
    },
  })
}

// ─── Deactivate Vendor ──────────────────────────────────────────

export async function deactivateVendor(id: string) {
  await requireFacility()

  await prisma.vendor.update({
    where: { id },
    data: { status: "inactive" },
  })
}
