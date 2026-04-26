"use server"

/**
 * Vendor-side mirror of the facility's per-purchase compliance audit
 * (v0 doc §5). Where the facility view answers "how compliant are
 * MY purchases?", this view answers "where is MY product being
 * bought off the contract I'm a party to?". Useful for vendors
 * pursuing under-utilized contracts.
 *
 * Each row = a COG record with this vendor's product where the
 * facility either had no active contract for the line, the contract
 * had expired by the purchase date, or the unit price diverged
 * meaningfully from the contracted price (v0 banding).
 */

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { v0CogPriceVarianceBand, type V0CogVarianceBand } from "@/lib/v0-spec/cog"

export type LeakageReason =
  | "OFF_CONTRACT"
  | "OUT_OF_PERIOD"
  | "PRICE_VARIANCE"

export interface LeakageRow {
  cogId: string
  facilityId: string
  facilityName: string
  vendorItemNo: string | null
  inventoryDescription: string | null
  transactionDate: string
  unitCost: number
  quantity: number
  extendedPrice: number
  reason: LeakageReason
  band: V0CogVarianceBand | null
  contractPrice: number | null
  variancePct: number | null
}

export interface VendorPurchaseLeakageReport {
  totalRows: number
  byReason: Record<LeakageReason, number>
  rows: LeakageRow[]
}

export async function getVendorPurchaseLeakage(input: {
  fromDate: string
  toDate: string
  /** Max rows returned in the response (after classification). */
  rowLimit?: number
}): Promise<VendorPurchaseLeakageReport> {
  const { vendor } = await requireVendor()
  const from = new Date(input.fromDate)
  const to = new Date(input.toDate)
  const rowLimit = input.rowLimit ?? 250

  // Pull every COG attributed to this vendor in window so the
  // counts (totalRows, byReason) reflect the full population —
  // truncating before classification would silently sample out
  // big-vendor / wide-window queries. Postgres caps via take
  // are still applied as a safety net (Prisma engine bound) but
  // the bound is well above any realistic vendor-window pair.
  //
  // Disclosure surface (security audit Medium 2026-04-26): facility
  // names returned here are for ANY facility that purchased this
  // vendor's product, including facilities the vendor doesn't
  // currently have a contract with (the OFF_CONTRACT branch is
  // exactly that — chase off-contract leakage). Acceptable per
  // vendor-side use case ("which customer is buying from us off
  // contract?"), but worth flagging in the spec since it discloses
  // facility identity beyond the explicit contract relationship.
  const cog = await prisma.cOGRecord.findMany({
    where: {
      vendorId: vendor.id,
      transactionDate: { gte: from, lte: to },
    },
    select: {
      id: true,
      facilityId: true,
      vendorItemNo: true,
      inventoryDescription: true,
      transactionDate: true,
      unitCost: true,
      quantity: true,
      extendedPrice: true,
    },
    take: 25_000,
    orderBy: { transactionDate: "desc" },
  })

  // Active contracts this vendor has with any facility in window.
  const contracts = await prisma.contract.findMany({
    where: {
      vendorId: vendor.id,
      status: "active",
    },
    select: {
      id: true,
      facilityId: true,
      effectiveDate: true,
      expirationDate: true,
      pricingItems: { select: { vendorItemNo: true, unitPrice: true } },
    },
  })
  const contractsByFacility = new Map<string, typeof contracts>()
  for (const c of contracts) {
    if (!c.facilityId) continue
    const arr = contractsByFacility.get(c.facilityId) ?? []
    arr.push(c)
    contractsByFacility.set(c.facilityId, arr)
  }

  const facilityIds = Array.from(
    new Set(cog.map((r) => r.facilityId).filter(Boolean) as string[]),
  )
  const facilities = await prisma.facility.findMany({
    where: { id: { in: facilityIds } },
    select: { id: true, name: true },
  })
  const facilityName = new Map(facilities.map((f) => [f.id, f.name]))

  const rows: LeakageRow[] = []
  const counts: Record<LeakageReason, number> = {
    OFF_CONTRACT: 0,
    OUT_OF_PERIOD: 0,
    PRICE_VARIANCE: 0,
  }

  for (const r of cog) {
    if (!r.facilityId) continue
    const facContracts = contractsByFacility.get(r.facilityId) ?? []
    const inPeriod = facContracts.filter(
      (c) =>
        c.effectiveDate <= r.transactionDate &&
        c.expirationDate >= r.transactionDate,
    )

    let reason: LeakageReason | null = null
    let band: V0CogVarianceBand | null = null
    let contractPrice: number | null = null
    let variancePct: number | null = null

    if (facContracts.length === 0) {
      reason = "OFF_CONTRACT"
    } else if (inPeriod.length === 0) {
      reason = "OUT_OF_PERIOD"
    } else if (r.vendorItemNo) {
      // Look for a contracted price on this item in any in-period contract.
      let matched: { unitPrice: number } | null = null
      for (const c of inPeriod) {
        const m = c.pricingItems.find((p) => p.vendorItemNo === r.vendorItemNo)
        if (m) {
          matched = { unitPrice: Number(m.unitPrice) }
          break
        }
      }
      if (matched) {
        const v = v0CogPriceVarianceBand(Number(r.unitCost), matched.unitPrice)
        if (
          v.band === "significant_overcharge" ||
          v.band === "significant_discount"
        ) {
          reason = "PRICE_VARIANCE"
          band = v.band
          contractPrice = matched.unitPrice
          variancePct = v.variancePct
        }
      }
    }

    if (reason) {
      counts[reason] += 1
      // Bound the response payload but keep counting against the
      // full population. The card surfaces a "+X more" hint via
      // (totalRows − rows.length) when this trips.
      if (rows.length < rowLimit) {
        rows.push({
          cogId: r.id,
          facilityId: r.facilityId,
          facilityName: facilityName.get(r.facilityId) ?? r.facilityId,
          vendorItemNo: r.vendorItemNo,
          inventoryDescription: r.inventoryDescription,
          transactionDate: r.transactionDate.toISOString(),
          unitCost: Number(r.unitCost),
          quantity: r.quantity,
          extendedPrice: Number(r.extendedPrice ?? 0),
          reason,
          band,
          contractPrice,
          variancePct,
        })
      }
    }
  }

  return serialize({
    totalRows: rows.length,
    byReason: counts,
    rows,
  })
}
