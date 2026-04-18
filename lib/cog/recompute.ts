/**
 * COG match-status recompute — the side-effect layer.
 *
 * Pairs the pure `matchCOGRecordToContract` + `enrichCOGRecord` functions
 * with actual DB reads/writes. Called from contract-CRUD actions so that
 * COG rows stay consistent with the live contract catalog.
 *
 * ─── Sign convention ────────────────────────────────────────────────
 * See lib/cog/enrichment.ts — all math is centralized there; this module
 * only does DB I/O and orchestration.
 */

import type { Prisma, PrismaClient } from "@prisma/client"
import {
  matchCOGRecordToContract,
  type ContractForMatch,
  type ContractPricingItemForMatch,
} from "@/lib/contracts/match"
import { enrichCOGRecord } from "@/lib/cog/enrichment"

type Db = PrismaClient | Prisma.TransactionClient

/**
 * Load contracts (with pricing + facilities) for a given vendor at a
 * facility. Returns the pure-function-friendly `ContractForMatch` shape
 * expected by `matchCOGRecordToContract`.
 */
export async function loadContractsForVendor(
  db: Db,
  vendorId: string,
  facilityId: string,
): Promise<ContractForMatch[]> {
  const contracts = await db.contract.findMany({
    where: {
      vendorId,
      status: { in: ["active", "expiring"] },
      OR: [
        { facilityId },
        { contractFacilities: { some: { facilityId } } },
      ],
    },
    select: {
      id: true,
      vendorId: true,
      status: true,
      effectiveDate: true,
      expirationDate: true,
      facilityId: true,
      contractFacilities: { select: { facilityId: true } },
      pricingItems: {
        select: {
          vendorItemNo: true,
          unitPrice: true,
          listPrice: true,
        },
      },
    },
  })

  return contracts.map((c) => {
    // Own-facility always counts (when set); multi-facility contracts expose
    // all through contractFacilities[]. De-dupe, dropping null.
    const rawIds = [c.facilityId, ...c.contractFacilities.map((cf) => cf.facilityId)]
    const facilityIds = Array.from(new Set(rawIds.filter((x): x is string => x !== null)))
    const pricingItems: ContractPricingItemForMatch[] = c.pricingItems.map((p) => ({
      vendorItemNo: p.vendorItemNo,
      unitPrice: Number(p.unitPrice),
      listPrice: p.listPrice === null ? null : Number(p.listPrice),
    }))
    return {
      id: c.id,
      vendorId: c.vendorId,
      status: c.status,
      effectiveDate: c.effectiveDate,
      expirationDate: c.expirationDate,
      facilityIds,
      pricingItems,
    }
  })
}

/**
 * Recompute `matchStatus` + enrichment columns for every COG record of
 * `vendorId` at `facilityId`. Runs in a single transaction; returns a
 * summary of how many rows flipped to each status.
 *
 * Safe to call even when `vendorId` has zero COG records (returns {
 * updated: 0 }). Safe to call with zero matching contracts (rows flip to
 * off_contract_item / unknown_vendor as appropriate).
 */
export async function recomputeMatchStatusesForVendor(
  db: Db,
  input: { vendorId: string; facilityId: string },
): Promise<{
  total: number
  updated: number
  onContract: number
  priceVariance: number
  offContract: number
  outOfScope: number
  unknownVendor: number
}> {
  const { vendorId, facilityId } = input

  const contracts = await loadContractsForVendor(db, vendorId, facilityId)

  const records = await db.cOGRecord.findMany({
    where: { facilityId, vendorId },
    select: {
      id: true,
      facilityId: true,
      vendorId: true,
      vendorName: true,
      vendorItemNo: true,
      unitCost: true,
      quantity: true,
      transactionDate: true,
    },
  })

  let updated = 0
  let onContract = 0
  let priceVariance = 0
  let offContract = 0
  let outOfScope = 0
  let unknownVendor = 0

  for (const r of records) {
    const result = matchCOGRecordToContract(
      {
        facilityId: r.facilityId,
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        vendorItemNo: r.vendorItemNo,
        unitCost: Number(r.unitCost),
        quantity: r.quantity,
        transactionDate: r.transactionDate,
      },
      contracts,
    )

    const cols = enrichCOGRecord(result, {
      quantity: r.quantity,
      unitCost: Number(r.unitCost),
    })

    await db.cOGRecord.update({
      where: { id: r.id },
      data: {
        matchStatus: cols.matchStatus,
        contractId: cols.contractId,
        contractPrice: cols.contractPrice === null ? null : cols.contractPrice,
        isOnContract: cols.isOnContract,
        savingsAmount: cols.savingsAmount === null ? null : cols.savingsAmount,
        variancePercent: cols.variancePercent === null ? null : cols.variancePercent,
      },
    })

    updated++
    switch (cols.matchStatus) {
      case "on_contract":
        onContract++
        break
      case "price_variance":
        priceVariance++
        break
      case "off_contract_item":
        offContract++
        break
      case "out_of_scope":
        outOfScope++
        break
      case "unknown_vendor":
        unknownVendor++
        break
      // "pending" is never produced by enrichment (it's the default DB state)
    }
  }

  return {
    total: records.length,
    updated,
    onContract,
    priceVariance,
    offContract,
    outOfScope,
    unknownVendor,
  }
}
