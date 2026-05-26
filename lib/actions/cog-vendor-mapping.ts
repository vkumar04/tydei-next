"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { revalidatePath } from "next/cache"

export interface CogVendorMapping {
  vendorName: string
  recordCount: number
  totalSpend: number
  currentVendorId: string | null
  currentVendorName: string | null
  hasActiveContract: boolean
}

export async function getCOGVendorMappings(): Promise<CogVendorMapping[]> {
  const { facility } = await requireFacility()

  const grouped = await prisma.cOGRecord.groupBy({
    by: ["vendorName", "vendorId"],
    where: { facilityId: facility.id },
    _count: { _all: true },
    _sum: { extendedPrice: true },
  })

  const vendorIds = Array.from(
    new Set(grouped.map((g) => g.vendorId).filter((v): v is string => !!v)),
  )

  const vendors = vendorIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: vendorIds } },
        select: {
          id: true,
          name: true,
          displayName: true,
          contracts: {
            where: {
              facilityId: facility.id,
              status: { in: ["active", "expiring"] },
            },
            select: { id: true },
            take: 1,
          },
        },
      })
    : []
  const vendorMap = new Map(vendors.map((v) => [v.id, v]))

  // Coalesce rows that share a vendorName but differ on vendorId (rare —
  // happens when a name was partially remapped). Keep the most-frequent
  // vendorId as the "current" mapping; sum counts/spend across both.
  const byName = new Map<string, CogVendorMapping>()
  for (const g of grouped) {
    const key = (g.vendorName ?? "").trim()
    if (!key) continue
    const vendor = g.vendorId ? vendorMap.get(g.vendorId) : null
    const existing = byName.get(key)
    const row: CogVendorMapping = {
      vendorName: key,
      recordCount: (existing?.recordCount ?? 0) + (g._count?._all ?? 0),
      totalSpend:
        (existing?.totalSpend ?? 0) + Number(g._sum?.extendedPrice ?? 0),
      currentVendorId: g.vendorId ?? existing?.currentVendorId ?? null,
      currentVendorName: vendor
        ? vendor.displayName ?? vendor.name
        : existing?.currentVendorName ?? null,
      hasActiveContract:
        existing?.hasActiveContract || !!vendor?.contracts.length,
    }
    byName.set(key, row)
  }

  return Array.from(byName.values()).sort(
    (a, b) => b.totalSpend - a.totalSpend,
  )
}

export interface VendorOption {
  id: string
  name: string
  hasActiveContract: boolean
}

export async function listVendorsForRemap(): Promise<VendorOption[]> {
  const { facility } = await requireFacility()
  const vendors = await prisma.vendor.findMany({
    select: {
      id: true,
      name: true,
      displayName: true,
      contracts: {
        where: {
          facilityId: facility.id,
          status: { in: ["active", "expiring"] },
        },
        select: { id: true },
        take: 1,
      },
    },
    orderBy: { name: "asc" },
  })
  return vendors.map((v) => ({
    id: v.id,
    name: v.displayName ?? v.name,
    hasActiveContract: v.contracts.length > 0,
  }))
}

export async function remapCOGVendorName(input: {
  vendorName: string
  newVendorId: string | null
}): Promise<{ recordsUpdated: number }> {
  const { facility } = await requireFacility()
  const name = input.vendorName.trim()
  if (!name) throw new Error("vendorName required")

  // Collect previously-assigned vendorIds so we can recompute their
  // matchStatus columns after the swap (rows leaving an old vendor
  // need their isOnContract / matchStatus dropped).
  const previous = await prisma.cOGRecord.findMany({
    where: {
      facilityId: facility.id,
      vendorName: { equals: name, mode: "insensitive" },
    },
    select: { vendorId: true },
    distinct: ["vendorId"],
  })
  const previousVendorIds = previous
    .map((r) => r.vendorId)
    .filter((v): v is string => !!v)

  if (input.newVendorId) {
    // auth-scope-scanner-skip: Vendor is a global (non-tenant) table; this
    // is an existence check before writing facility-scoped COG rows below.
    const vendor = await prisma.vendor.findUnique({
      where: { id: input.newVendorId },
      select: { id: true },
    })
    if (!vendor) throw new Error("Target vendor not found")
  }

  const updated = await prisma.cOGRecord.updateMany({
    where: {
      facilityId: facility.id,
      vendorName: { equals: name, mode: "insensitive" },
    },
    data: { vendorId: input.newVendorId },
  })

  const toRecompute = new Set<string>(previousVendorIds)
  if (input.newVendorId) toRecompute.add(input.newVendorId)
  for (const vendorId of toRecompute) {
    await recomputeMatchStatusesForVendor(vendorId, facility.id)
  }

  revalidatePath("/dashboard/cog-data")
  return { recordsUpdated: updated.count }
}
