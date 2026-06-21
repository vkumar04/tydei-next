"use server"

/**
 * Vendor Opportunity Engine — real DB seed.
 *
 * Derives the deal-scenario starting point from the vendor's own data:
 *   - currentAsp / currentRevenue  → the vendor's trailing-12mo COG sales
 *     (rows in facility COGRecord attributed to this vendor)
 *   - addressableSpend             → total facility spend in the categories
 *     the vendor competes in, across the facilities it sells to
 *   - currentShare                 → currentRevenue ÷ addressableSpend
 *
 * Categories are matched canonically (CLAUDE.md invariant). When the vendor
 * has no sales yet, the caller falls back to the engine defaults.
 */

import { requireVendor } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { serialize } from "@/lib/serialize"
import { canonicalizeCategoryName } from "@/lib/contracts/category-canonical"

export interface VendorOpportunityData {
  currentAsp: number
  currentRevenue: number
  addressableSpend: number
  /** 0–1. */
  currentShare: number
  hasData: boolean
}

export async function getVendorOpportunityData(): Promise<VendorOpportunityData> {
  const { vendor } = await requireVendor()

  const windowEnd = new Date()
  const windowStart = new Date(windowEnd)
  windowStart.setFullYear(windowStart.getFullYear() - 1)

  // The vendor's own sales (trailing 12mo) across every facility.
  const vendorRows = await prisma.cOGRecord.findMany({
    where: { vendorId: vendor.id, transactionDate: { gte: windowStart, lte: windowEnd } },
    select: {
      extendedPrice: true,
      quantity: true,
      category: true,
      facilityId: true,
    },
  })

  let currentRevenue = 0
  let vendorQty = 0
  const canonicalCats = new Set<string>()
  const facilityIds = new Set<string>()
  for (const r of vendorRows) {
    currentRevenue += Number(r.extendedPrice ?? 0)
    vendorQty += r.quantity ?? 0
    if (r.category) canonicalCats.add(canonicalizeCategoryName(r.category))
    facilityIds.add(r.facilityId)
  }

  // Total facility spend in those categories + facilities = addressable market.
  let addressableSpend = 0
  if (canonicalCats.size > 0 && facilityIds.size > 0) {
    const marketRows = await prisma.cOGRecord.findMany({
      where: {
        facilityId: { in: [...facilityIds] },
        transactionDate: { gte: windowStart, lte: windowEnd },
        category: { not: null },
      },
      select: { extendedPrice: true, category: true },
    })
    for (const r of marketRows) {
      if (r.category && canonicalCats.has(canonicalizeCategoryName(r.category))) {
        addressableSpend += Number(r.extendedPrice ?? 0)
      }
    }
  }

  const currentAsp = vendorQty > 0 ? currentRevenue / vendorQty : 0
  const currentShare =
    addressableSpend > 0 ? Math.min(1, currentRevenue / addressableSpend) : 0

  return serialize({
    currentAsp,
    currentRevenue,
    addressableSpend,
    currentShare,
    hasData: vendorRows.length > 0,
  })
}
