"use server"

/**
 * Vendor-owned COG reads (1-way mode).
 *
 * `getVendorCogRecords` + `getVendorCogStats` read the VENDOR's own
 * `VendorCogRecord` rows. Every read is scoped through the ONE canonical
 * filter `vendorCogScopedByDivisions` (`lib/contracts/vendor-cog-scope.ts`)
 * with the caller's accessible divisions resolved by `callerVendorDivisionIds`
 * — hard division isolation, same `undefined / [] / [ids]` semantics as the
 * contract-vendor helpers. Decimal/Date values are `serialize()`d before
 * crossing to the client.
 *
 * This NEVER touches the facility-scoped `COGRecord` table — vendor COG is a
 * separate, vendor-owned surface.
 */

import { requireVendor } from "@/lib/actions/auth"
import { callerVendorDivisionIds } from "@/lib/actions/division-auth"
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { vendorCogScopedByDivisions } from "@/lib/contracts/vendor-cog-scope"

export interface VendorCogRecordRow {
  id: string
  vendorDivisionId: string | null
  vendorName: string | null
  inventoryNumber: string
  inventoryDescription: string
  vendorItemNo: string | null
  manufacturerNo: string | null
  poNumber: string | null
  unitCost: number
  extendedPrice: number | null
  quantity: number
  transactionDate: string
  category: string | null
  isOnContract: boolean
  createdAt: string
}

export interface VendorCogFilters {
  /** Free-text match on SKU / description / vendor item number. */
  search?: string
  /** Exact (canonical) category filter. */
  category?: string
  /** Max rows returned (most recent first). */
  limit?: number
}

export interface VendorCogStats {
  totalRecords: number
  totalSpend: number
  onContractCount: number
  /** Distinct category names present in the vendor's COG. */
  categoryCount: number
  /** Most recent transaction date (ISO), or null when no rows. */
  latestTransactionDate: string | null
}

/**
 * List the caller-vendor's COG rows, division-scoped, newest first.
 */
export async function getVendorCogRecords(
  filters: VendorCogFilters = {},
): Promise<VendorCogRecordRow[]> {
  const session = await requireVendor()
  const divisionIds = await callerVendorDivisionIds(
    session.user.id,
    session.vendor.id,
  )

  const where = vendorCogScopedByDivisions(session.vendor.id, divisionIds)

  if (filters.category) {
    where.category = filters.category
  }
  if (filters.search?.trim()) {
    const q = filters.search.trim()
    where.OR = [
      { inventoryNumber: { contains: q, mode: "insensitive" } },
      { inventoryDescription: { contains: q, mode: "insensitive" } },
      { vendorItemNo: { contains: q, mode: "insensitive" } },
    ]
  }

  const rows = await prisma.vendorCogRecord.findMany({
    where,
    orderBy: { transactionDate: "desc" },
    take: filters.limit ?? 100,
    select: {
      id: true,
      vendorDivisionId: true,
      vendorName: true,
      inventoryNumber: true,
      inventoryDescription: true,
      vendorItemNo: true,
      manufacturerNo: true,
      poNumber: true,
      unitCost: true,
      extendedPrice: true,
      quantity: true,
      transactionDate: true,
      category: true,
      isOnContract: true,
      createdAt: true,
    },
  })

  // serialize() converts Decimal→number at runtime; the static type is
  // identity, so route through `unknown` to land on the number-typed row.
  return serialize(rows) as unknown as VendorCogRecordRow[]
}

/**
 * Aggregate summary for the caller-vendor's COG (division-scoped).
 */
export async function getVendorCogStats(): Promise<VendorCogStats> {
  const session = await requireVendor()
  const divisionIds = await callerVendorDivisionIds(
    session.user.id,
    session.vendor.id,
  )
  const where = vendorCogScopedByDivisions(session.vendor.id, divisionIds)

  const [agg, onContractCount, distinctCategories, latest] = await Promise.all([
    prisma.vendorCogRecord.aggregate({
      where,
      _count: { _all: true },
      _sum: { extendedPrice: true },
    }),
    prisma.vendorCogRecord.count({ where: { ...where, isOnContract: true } }),
    prisma.vendorCogRecord.findMany({
      where: { ...where, category: { not: null } },
      distinct: ["category"],
      select: { category: true },
    }),
    prisma.vendorCogRecord.findFirst({
      where,
      orderBy: { transactionDate: "desc" },
      select: { transactionDate: true },
    }),
  ])

  return {
    totalRecords: agg._count._all,
    totalSpend: agg._sum.extendedPrice ? Number(agg._sum.extendedPrice) : 0,
    onContractCount,
    categoryCount: distinctCategories.filter((c) => c.category).length,
    latestTransactionDate: latest?.transactionDate
      ? latest.transactionDate.toISOString()
      : null,
  }
}
