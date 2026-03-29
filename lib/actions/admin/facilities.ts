"use server"

import { prisma } from "@/lib/db"
import { requireAdmin } from "@/lib/actions/auth"
import type { AdminCreateFacilityInput, AdminUpdateFacilityInput } from "@/lib/validators/admin"
import { serialize } from "@/lib/serialize"

// ─── Types ───────────────────────────────────────────────────────

export interface AdminFacilityRow {
  id: string
  name: string
  type: string
  city: string | null
  state: string | null
  beds: number | null
  status: string
  healthSystemName: string | null
  userCount: number
  contractCount: number
  createdAt: string
}

// ─── List Facilities ────────────────────────────────────────────

export async function adminGetFacilities(input: {
  search?: string
  status?: string
  page?: number
  pageSize?: number
}): Promise<{ facilities: AdminFacilityRow[]; total: number }> {
  await requireAdmin()
  const { search, status, page = 1, pageSize = 20 } = input

  const where: Record<string, unknown> = {}
  if (search) where.name = { contains: search, mode: "insensitive" }
  if (status) where.status = status

  const [facilities, total] = await Promise.all([
    prisma.facility.findMany({
      where,
      include: {
        healthSystem: { select: { name: true } },
        _count: { select: { contracts: true } },
        organization: { include: { _count: { select: { members: true } } } },
      },
      orderBy: { name: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.facility.count({ where }),
  ])

  return serialize({
    facilities: facilities.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      city: f.city,
      state: f.state,
      beds: f.beds,
      status: f.status,
      healthSystemName: f.healthSystem?.name ?? null,
      userCount: f.organization?._count?.members ?? 0,
      contractCount: f._count.contracts,
      createdAt: f.createdAt.toISOString(),
    })),
    total,
  })
}

// ─── Create Facility ────────────────────────────────────────────

export async function adminCreateFacility(input: AdminCreateFacilityInput) {
  await requireAdmin()

  const facility = await prisma.facility.create({ data: input })
  return serialize(facility)
}

// ─── Update Facility ────────────────────────────────────────────

export async function adminUpdateFacility(id: string, input: AdminUpdateFacilityInput) {
  await requireAdmin()

  const facility = await prisma.facility.update({ where: { id }, data: input })
  return serialize(facility)
}

// ─── Delete Facility ────────────────────────────────────────────

export async function adminDeleteFacility(id: string) {
  await requireAdmin()

  await prisma.facility.delete({ where: { id } })
}
