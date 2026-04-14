"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import type { AdminCreateVendorInput, AdminUpdateVendorInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface AdminVendorRow {
  id: string
  name: string
  code: string | null
  contactName: string | null
  contactEmail: string | null
  status: string
  tier: string
  contractCount: number
  repCount: number
  createdAt: string
}

// ─── List Vendors ───────────────────────────────────────────────

export async function adminGetVendors(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ vendors: AdminVendorRow[]; total: number }> {
  await requireAdmin()
  const { search, status, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (search) where.name = { contains: search, mode: "insensitive" }
  if (status) where.status = status

  const [vendors, total] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include: { _count: { select: { contracts: true, divisions: true } } },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.vendor.count({ where }),
  ])

  return serialize({
    vendors: vendors.map((v) => ({
      id: v.id,
      name: v.name,
      code: v.code,
      contactName: v.contactName,
      contactEmail: v.contactEmail,
      status: v.status,
      tier: v.tier,
      contractCount: v._count.contracts,
      repCount: v._count.divisions,
      createdAt: v.createdAt.toISOString(),
    })),
    total,
  })
}

// ─── Create Vendor ──────────────────────────────────────────────

export async function adminCreateVendor(input: AdminCreateVendorInput) {
  await requireAdmin()

  const vendor = await prisma.vendor.create({ data: input })
  return serialize(vendor)
}

// ─── Update Vendor ──────────────────────────────────────────────

export async function adminUpdateVendor(id: string, input: AdminUpdateVendorInput) {
  await requireAdmin()

  const vendor = await prisma.vendor.update({ where: { id }, data: input })
  return serialize(vendor)
}

// ─── Delete Vendor ──────────────────────────────────────────────

export async function adminDeleteVendor(id: string) {
  await requireAdmin()

  await prisma.vendor.delete({ where: { id } })
}
