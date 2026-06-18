"use server"

/**
 * Case-costing — Surgeon × Vendor spend report (Charles 2026-06-18).
 *
 * Per surgeon, how much they spend with each vendor — from case supplies
 * (which carry the surgeon via the case and the SKU via `vendorItemNo`) — with
 * a contract-compliance split. COGRecord itself has no surgeon, so the
 * attribution flows through case supplies; the COG data provides the SKU→vendor
 * mapping for OFF-contract supplies (on-contract supplies get the vendor of
 * their contract).
 *
 * Vendor resolution per supply:
 *   1. on-contract (supply.contractId set) → that contract's primary vendor.
 *   2. else SKU match: normalizeSku(vendorItemNo) → a COGRecord's vendorName.
 *   3. else "Unknown vendor".
 *
 * Compliance% per (surgeon, vendor) = on-contract spend ÷ total spend.
 *
 * Contracts are facility-scoped via `contractsOwnedByFacility`; COG + supply
 * reads are scoped to `facility.id`. Output is plain JSON via `serialize`.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { serialize } from "@/lib/serialize"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import {
  buildSurgeonVendorSpend,
  UNKNOWN_VENDOR,
  type SVCase,
  type SVSupply,
  type SurgeonVendorSpendRow,
} from "@/lib/case-costing/surgeon-vendor-spend"

// from-form re-export ONLY — a LOCAL `export type { SurgeonVendorSpendRow }`
// (no `from`) is NOT erased by Turbopack's prod server-action transform and
// crashes every action in the file (CLAUDE.md use-server rule).
export type { SurgeonVendorSpendRow } from "@/lib/case-costing/surgeon-vendor-spend"

export interface GetSurgeonVendorSpendInput {
  facilityId?: string
  /** ISO date (YYYY-MM-DD); inclusive lower bound on dateOfSurgery. */
  dateFrom?: string
  /** ISO date (YYYY-MM-DD); inclusive upper bound on dateOfSurgery. */
  dateTo?: string
}

function parseDateOrThrow(label: string, value: string): Date {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) {
    throw new Error(`getSurgeonVendorSpend: invalid ${label} (${value})`)
  }
  return d
}

export async function getSurgeonVendorSpend(
  input: GetSurgeonVendorSpendInput = {},
): Promise<SurgeonVendorSpendRow[]> {
  const { facility } = await requireFacility()

  // ─── 1. contractId → primary vendor name (on-contract supplies) ──
  const ownedContracts = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: { id: true, vendorId: true },
  })
  const vendorIds = [...new Set(ownedContracts.map((c) => c.vendorId))]
  const vendors = await prisma.vendor.findMany({
    where: { id: { in: vendorIds } },
    select: { id: true, name: true },
  })
  const vendorNameById = new Map(vendors.map((v) => [v.id, v.name]))
  const vendorNameByContract = new Map(
    ownedContracts.map((c) => [
      c.id,
      vendorNameById.get(c.vendorId) ?? UNKNOWN_VENDOR,
    ]),
  )

  // ─── 2. cases + supplies (in window) ─────────────────────────────
  const dateFilter: { gte?: Date; lte?: Date } = {}
  if (input.dateFrom) dateFilter.gte = parseDateOrThrow("dateFrom", input.dateFrom)
  if (input.dateTo) dateFilter.lte = parseDateOrThrow("dateTo", input.dateTo)

  const cases = await prisma.case.findMany({
    where: {
      facilityId: facility.id,
      ...(dateFilter.gte || dateFilter.lte ? { dateOfSurgery: dateFilter } : {}),
    },
    select: {
      surgeonName: true,
      supplies: {
        select: {
          isOnContract: true,
          contractId: true,
          vendorItemNo: true,
          extendedCost: true,
        },
      },
    },
  })

  const svCases: SVCase[] = cases.map((c) => ({
    surgeonName: c.surgeonName,
    supplies: c.supplies.map((s) => ({
      isOnContract: s.isOnContract,
      contractId: s.contractId,
      vendorItemNo: s.vendorItemNo,
      extendedCost: Number(s.extendedCost),
    })),
  }))

  // ─── 3. normalized SKU → vendor name (off-contract supplies) ─────
  // The "pull from COGS" linkage. Use groupBy to collapse the COG table to
  // DISTINCT (vendorItemNo, inventoryNumber, vendorName) DB-side instead of
  // loading all ~46k rows into JS (2026-06-18 perf audit) — behaviour-
  // identical to the full scan (same normalized map) but bounded by the
  // distinct-SKU count, and it preserves normalization variants a raw-`in`
  // SKU filter would miss.
  const offContractNeedsSku = svCases.some((c) =>
    c.supplies.some((s) => !s.contractId && s.extendedCost > 0),
  )
  const vendorNameBySku = new Map<string, string>()
  if (offContractNeedsSku) {
    const cogGroups = await prisma.cOGRecord.groupBy({
      by: ["vendorItemNo", "inventoryNumber", "vendorName"],
      where: { facilityId: facility.id, vendorName: { not: null } },
      _count: { _all: true },
    })
    // Some SKUs appear under multiple vendors in COG history. Resolve each
    // normalized SKU to its MOST-COMMON vendor (ties broken alphabetically)
    // — deterministic, and better than the prior arbitrary row-order
    // "first wins" (which differed run-to-run).
    const skuVendorCounts = new Map<string, Map<string, number>>()
    for (const r of cogGroups) {
      if (!r.vendorName) continue
      const cnt = r._count._all
      for (const sku of [r.vendorItemNo, r.inventoryNumber]) {
        const n = normalizeSku(sku)
        if (!n) continue
        let m = skuVendorCounts.get(n)
        if (!m) {
          m = new Map()
          skuVendorCounts.set(n, m)
        }
        m.set(r.vendorName, (m.get(r.vendorName) ?? 0) + cnt)
      }
    }
    for (const [sku, vendors] of skuVendorCounts) {
      let best = ""
      let bestCount = -1
      for (const [vendor, count] of vendors) {
        if (count > bestCount || (count === bestCount && vendor < best)) {
          best = vendor
          bestCount = count
        }
      }
      vendorNameBySku.set(sku, best)
    }
  }

  const resolveVendor = (s: SVSupply): string => {
    if (s.contractId && vendorNameByContract.has(s.contractId)) {
      return vendorNameByContract.get(s.contractId)!
    }
    const n = normalizeSku(s.vendorItemNo)
    if (n && vendorNameBySku.has(n)) return vendorNameBySku.get(n)!
    return UNKNOWN_VENDOR
  }

  return serialize(buildSurgeonVendorSpend(svCases, resolveVendor))
}
