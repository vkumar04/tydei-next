/**
 * Vendor-owned COG match pipeline (Charles 2026-06-20 "reading the COGS the
 * vendor loads here" → "On Contract 0").
 *
 * The vendor uploads its own cost-of-goods to `VendorCogRecord` (1-way mode).
 * Those rows were never matched against anything — `isOnContract` stayed at its
 * schema default `false` forever, so the COGS tab's "On Contract" count was
 * structurally always 0. This mirrors the facility matcher
 * (`recomputeMatchStatusesForVendor`) but reads/writes `VendorCogRecord` and
 * matches against the VENDOR'S OWN contracts (no facility constraint — a 1-way
 * standalone vendor has no facility).
 *
 * Reuses the pure cascade resolver `resolveContractForCOG` (lib/cog/match.ts);
 * the vendor case needs neither the PricingFile fallback nor fuzzy vendor
 * resolution (every row already carries the vendor's own id).
 */
import { prisma } from "@/lib/db"
import { normalizeSku } from "@/lib/contracts/normalize-sku"
import { PRICE_VARIANCE_THRESHOLD } from "@/lib/contracts/match"
import {
  resolveContractForCOG,
  type PricingCandidate,
  type ContractCandidate,
  type ResolveContext,
} from "@/lib/cog/match"
import { contractsOwnedByVendor } from "@/lib/actions/contracts-vendor-auth"
import { vendorCogScopedByDivisions } from "@/lib/contracts/vendor-cog-scope"
import { contractVendorIds } from "@/lib/contracts/contract-vendor-ids"
import type { COGMatchStatus, Prisma } from "@/lib/generated/prisma/client"
import { roundToCents } from "@/lib/money/round"

export interface VendorCogMatchSummary {
  total: number
  updated: number
  onContract: number
  priceVariance: number
  offContract: number
}

/**
 * Best SKU to match a vendor-COG row on. Vendor COG carries its item number in
 * `inventoryNumber` (required); `vendorItemNo`/`manufacturerNo` are optional
 * alternates (often null — real Stryker exports put the catalog number in
 * inventoryNumber, e.g. "M2864"). Try the explicit fields first, then fall
 * back to inventoryNumber.
 */
export function vendorCogSkuSource(row: {
  vendorItemNo: string | null
  manufacturerNo: string | null
  inventoryNumber: string | null
}): string | null {
  return row.vendorItemNo || row.manufacturerNo || row.inventoryNumber || null
}

/** Pure per-row classifier — unit-testable without a DB. */
export function classifyVendorCogRow(
  row: {
    vendorItemNo: string | null
    manufacturerNo: string | null
    inventoryNumber: string | null
    vendorName: string | null
    transactionDate: Date
    unitCost: number
    quantity: number
  },
  vendorId: string,
  ctx: ResolveContext,
  /** `${contractId}::${normalizedSku}` → contract unitPrice. */
  priceBySkuContract: Map<string, number>,
  /**
   * True when ANY of the vendor's contracts has a priced catalog. When true,
   * a vendor+date-only match (SKU not on any catalog) is genuinely
   * OFF-contract — mirrors the facility matcher's catalogPresent guard so we
   * don't flip every row to on-contract via the weak vendor+date signal.
   */
  catalogPresent: boolean,
): {
  matchStatus: COGMatchStatus
  isOnContract: boolean
  contractId: string | null
  contractPrice: number | null
  savingsAmount: number | null
  variancePercent: number | null
} {
  const skuRaw = vendorCogSkuSource(row)
  const res = resolveContractForCOG(
    {
      vendorItemNo: skuRaw,
      vendorId,
      transactionDate: row.transactionDate,
      vendorName: row.vendorName,
    },
    ctx,
  )
  const offContract = {
    matchStatus: "off_contract_item" as const,
    isOnContract: false,
    contractId: null,
    contractPrice: null,
    savingsAmount: null,
    variancePercent: null,
  }
  if (!res.contractId) return offContract

  const sku = normalizeSku(skuRaw)
  const cp = sku ? priceBySkuContract.get(`${res.contractId}::${sku}`) : undefined
  if (cp == null) {
    // Matched by vendor + date only (no priced SKU). Trust it as on-contract
    // ONLY when no contract has a catalog; otherwise the SKU simply isn't on
    // the priced catalog → off-contract.
    if (catalogPresent) return offContract
    return {
      matchStatus: "on_contract",
      isOnContract: true,
      contractId: res.contractId,
      contractPrice: null,
      savingsAmount: null,
      variancePercent: null,
    }
  }
  const variancePct = cp === 0 ? 0 : ((row.unitCost - cp) / cp) * 100
  if (Math.abs(variancePct) > PRICE_VARIANCE_THRESHOLD) {
    return {
      matchStatus: "price_variance",
      isOnContract: true,
      contractId: res.contractId,
      contractPrice: cp,
      savingsAmount: null,
      variancePercent: Math.round(variancePct * 100) / 100,
    }
  }
  return {
    matchStatus: "on_contract",
    isOnContract: true,
    contractId: res.contractId,
    contractPrice: cp,
    savingsAmount: roundToCents((cp - row.unitCost) * row.quantity),
    variancePercent: null,
  }
}

/**
 * Re-match every `VendorCogRecord` for a vendor (division-scoped) against the
 * vendor's own active contracts, writing back the enrichment columns.
 */
export async function recomputeMatchStatusesForVendorCog(
  vendorId: string,
  divisionIds?: string[],
): Promise<VendorCogMatchSummary> {
  const contracts = await prisma.contract.findMany({
    where: contractsOwnedByVendor(vendorId, divisionIds),
    select: {
      id: true,
      effectiveDate: true,
      expirationDate: true,
      status: true,
      vendorId: true,
      additionalVendorIds: true,
      pricingItems: { select: { vendorItemNo: true, unitPrice: true } },
    },
  })

  // Build the cascade lookup maps once (same shape the facility matcher uses).
  const pricingByVendorItem = new Map<string, PricingCandidate[]>()
  const activeContractsByVendor = new Map<string, ContractCandidate[]>()
  const priceBySkuContract = new Map<string, number>()
  for (const c of contracts) {
    if (c.expirationDate === null) continue
    if (c.status !== "active" && c.status !== "expiring") continue
    const candidate: ContractCandidate = {
      id: c.id,
      effectiveDate: c.effectiveDate,
      expirationDate: c.expirationDate,
    }
    for (const vid of contractVendorIds(c)) {
      const list = activeContractsByVendor.get(vid) ?? []
      list.push(candidate)
      activeContractsByVendor.set(vid, list)
    }
    for (const p of c.pricingItems) {
      const sku = normalizeSku(p.vendorItemNo)
      if (!sku) continue
      const list = pricingByVendorItem.get(sku) ?? []
      list.push({
        contractId: c.id,
        effectiveStart: c.effectiveDate,
        effectiveEnd: c.expirationDate,
      })
      pricingByVendorItem.set(sku, list)
      priceBySkuContract.set(`${c.id}::${sku}`, Number(p.unitPrice))
    }
  }
  const ctx: ResolveContext = {
    pricingByVendorItem,
    activeContractsByVendor,
    fuzzyVendorMatch: () => null,
  }
  const catalogPresent = pricingByVendorItem.size > 0

  const records = await prisma.vendorCogRecord.findMany({
    where: vendorCogScopedByDivisions(vendorId, divisionIds),
    select: {
      id: true,
      vendorItemNo: true,
      manufacturerNo: true,
      inventoryNumber: true,
      vendorName: true,
      transactionDate: true,
      unitCost: true,
      quantity: true,
    },
  })

  let onContract = 0
  let priceVariance = 0
  let offContract = 0
  let updated = 0
  const BATCH_SIZE = 500
  const pending: Prisma.PrismaPromise<unknown>[] = []
  const flush = async () => {
    if (pending.length === 0) return
    await Promise.all(pending)
    pending.length = 0
  }

  for (const r of records) {
    const c = classifyVendorCogRow(
      {
        vendorItemNo: r.vendorItemNo,
        manufacturerNo: r.manufacturerNo,
        inventoryNumber: r.inventoryNumber,
        vendorName: r.vendorName,
        transactionDate: r.transactionDate,
        unitCost: Number(r.unitCost),
        quantity: r.quantity,
      },
      vendorId,
      ctx,
      priceBySkuContract,
      catalogPresent,
    )
    if (c.matchStatus === "price_variance") priceVariance++
    else if (c.isOnContract) onContract++
    else offContract++
    pending.push(
      prisma.vendorCogRecord.update({
        where: { id: r.id },
        data: {
          matchStatus: c.matchStatus,
          isOnContract: c.isOnContract,
          contractId: c.contractId,
          contractPrice: c.contractPrice,
          savingsAmount: c.savingsAmount,
          variancePercent: c.variancePercent,
        },
      }),
    )
    updated++
    if (pending.length >= BATCH_SIZE) await flush()
  }
  await flush()

  return {
    total: records.length,
    updated,
    onContract: onContract + priceVariance,
    priceVariance,
    offContract,
  }
}
