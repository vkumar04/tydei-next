"use server"

import { prisma } from "@/lib/db"
import { requireAdmin, requireFacility } from "@/lib/actions/auth"
import {
  vendorFiltersSchema,
  createVendorSchema,
  updateVendorSchema,
  type VendorFilters,
  type CreateVendorInput,
  type UpdateVendorInput,
} from "@/lib/validators/vendors"
import type { Prisma } from "@prisma/client"
import { serialize } from "@/lib/serialize"

// ─── List Vendors (simple - for dropdowns) ──────────────────────

export async function getVendors() {
  await requireFacility()

  // Return all non-inactive vendors so newly-auto-created vendors from COG
  // imports appear without requiring explicit status activation.
  const vendors = await prisma.vendor.findMany({
    where: { status: { not: "inactive" } },
    select: { id: true, name: true, displayName: true },
    orderBy: { name: "asc" },
  })
  return serialize(vendors)
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

  return serialize({ vendors, total })
}

// ─── Single Vendor ──────────────────────────────────────────────

export async function getVendor(id: string) {
  await requireFacility()

  const vendor = await prisma.vendor.findUniqueOrThrow({
    where: { id },
    include: { divisions: true, childVendors: true },
  })
  return serialize(vendor)
}

// ─── Create Vendor ──────────────────────────────────────────────

export async function createVendor(input: CreateVendorInput) {
  await requireFacility()
  const data = createVendorSchema.parse(input)

  const vendor = await prisma.vendor.create({
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
  return serialize(vendor)
}

// ─── Update Vendor ──────────────────────────────────────────────

export async function updateVendor(id: string, input: UpdateVendorInput) {
  // Charles audit deferred-fix: Vendor rows are shared across
  // facilities, so mutation must be admin-gated. A facility user
  // changing another vendor's contact info or division would
  // silently affect every other tenant's view of that vendor.
  await requireAdmin()
  const data = updateVendorSchema.parse(input)

  const vendor = await prisma.vendor.update({
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
  return serialize(vendor)
}

// ─── Deactivate Vendor ──────────────────────────────────────────

export async function deactivateVendor(id: string) {
  // Charles audit deferred-fix: deactivating a vendor affects every
  // facility that has a connection to it — admin-only.
  await requireAdmin()

  await prisma.vendor.update({
    where: { id },
    data: { status: "inactive" },
  })
}
