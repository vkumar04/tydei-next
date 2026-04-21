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
  type MatchResult,
} from "@/lib/contracts/match"
import { enrichCOGRecord } from "@/lib/cog/enrichment"
import {
  resolveContractForCOG,
  type ContractCandidate,
  type PricingCandidate,
  type ResolveContext,
} from "@/lib/cog/match"
import { prisma as defaultPrisma } from "@/lib/db"

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
          // Charles iMessage 2026-04-20 N15: "category from that
          // pricing file needs to map to the COG data." When a COG
          // row matches a ContractPricing row, the COG's category is
          // filled from the pricing row if empty. Driven here to keep
          // the select consistent with what the matcher returns.
          category: true,
        },
      },
      // Charles W1.W-C4: load term scope so the matcher can enforce
      // category filters on `specific_category` terms.
      terms: {
        select: {
          appliesTo: true,
          categories: true,
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
      category: (p as { category?: string | null }).category ?? null,
    }))
    return {
      id: c.id,
      vendorId: c.vendorId,
      status: c.status,
      effectiveDate: c.effectiveDate,
      expirationDate: c.expirationDate,
      facilityIds,
      pricingItems,
      // Charles W1.W-C4: `terms` may be undefined when mocked (e.g.
      // older recompute tests); default to an empty array so the
      // matcher treats the contract as broadly-scoped.
      terms: (c.terms ?? []).map((t) => ({
        appliesTo: t.appliesTo,
        categories: t.categories,
      })),
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
}>
export async function recomputeMatchStatusesForVendor(
  vendorId: string,
  facilityId: string,
): Promise<{
  total: number
  updated: number
  onContract: number
  priceVariance: number
  offContract: number
  outOfScope: number
  unknownVendor: number
}>
export async function recomputeMatchStatusesForVendor(
  dbOrVendorId: Db | string,
  inputOrFacilityId: { vendorId: string; facilityId: string } | string,
): Promise<{
  total: number
  updated: number
  onContract: number
  priceVariance: number
  offContract: number
  outOfScope: number
  unknownVendor: number
}> {
  const db: Db =
    typeof dbOrVendorId === "string" ? defaultPrisma : dbOrVendorId
  const { vendorId, facilityId } =
    typeof dbOrVendorId === "string"
      ? { vendorId: dbOrVendorId, facilityId: inputOrFacilityId as string }
      : (inputOrFacilityId as { vendorId: string; facilityId: string })

  const contracts = await loadContractsForVendor(db, vendorId, facilityId)

  // ─── Build cascade lookup maps once (Task 5, subsystem 10.5) ───
  // The pure resolver in lib/cog/match.ts expects pre-built maps so we
  // avoid O(records × contracts) scans in the row loop.
  const pricingByVendorItem = new Map<string, PricingCandidate[]>()
  const activeContractsByVendor = new Map<string, ContractCandidate[]>()
  for (const c of contracts) {
    // Skip contracts with null expirationDate — the cascade requires a
    // bounded window; the legacy matcher below still handles open-ended
    // contracts via its own date filter.
    if (c.expirationDate === null) continue
    if (c.status !== "active" && c.status !== "expiring") continue
    if (!c.facilityIds.includes(facilityId)) continue

    const contractCandidate: ContractCandidate = {
      id: c.id,
      effectiveDate: c.effectiveDate,
      expirationDate: c.expirationDate,
    }
    const byVendor = activeContractsByVendor.get(c.vendorId) ?? []
    byVendor.push(contractCandidate)
    activeContractsByVendor.set(c.vendorId, byVendor)

    for (const p of c.pricingItems) {
      const pricingCandidate: PricingCandidate = {
        contractId: c.id,
        effectiveStart: c.effectiveDate,
        effectiveEnd: c.expirationDate,
      }
      const list = pricingByVendorItem.get(p.vendorItemNo) ?? []
      list.push(pricingCandidate)
      pricingByVendorItem.set(p.vendorItemNo, list)
    }
  }

  // recomputeMatchStatusesForVendor is already scoped to a single
  // vendorId, so fuzzy-name → vendor resolution adds no signal here
  // (every in-scope COG row already carries that vendorId). We pass a
  // no-op callback; full-import flows that need fuzzy should build their
  // own ResolveContext with `matchVendorByAlias` from @/lib/vendor-aliases.
  const resolveCtx: ResolveContext = {
    pricingByVendorItem,
    activeContractsByVendor,
    fuzzyVendorMatch: () => null,
  }

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
      // Charles W1.W-C4: thread category into the matcher so
      // `specific_category` terms can enforce scope.
      category: true,
    },
  })

  let updated = 0
  let onContract = 0
  let priceVariance = 0
  let offContract = 0
  let outOfScope = 0
  let unknownVendor = 0

  // ─── Batch update loop (Charles R5.30) ───────────────────────────────
  // Previously this did `await db.cOGRecord.update(…)` per record
  // serially. At 20k+ records that's ~20k sequential round-trips which
  // reliably exceeds the 60s dev-server timeout. We now accumulate 500
  // update promises per chunk and fire them with Promise.all so Prisma
  // can pipeline them. 500 is a safe sweet-spot — small enough that
  // pg's parameter cap (~65k params across the chunk) can't be blown,
  // large enough to keep the connection pool saturated.
  const BATCH_SIZE = 500
  const pendingUpdates: Prisma.PrismaPromise<unknown>[] = []
  let processedSinceLog = 0
  let processedTotal = 0

  const flush = async () => {
    if (pendingUpdates.length === 0) return
    await Promise.all(pendingUpdates)
    pendingUpdates.length = 0
  }

  for (const r of records) {
    // Cascade resolver (Task 5): vendorItemNo → vendor+date → fuzzy.
    // The returned `mode` is informational at this layer — we still fall
    // through to the enrichment matcher for variance/scope classification
    // so existing `price_variance` / `out_of_scope` / `unknown_vendor`
    // semantics are preserved. The cascade's job here is to short-circuit
    // the match to a specific contract when one exists, and to drive the
    // matchStatus enum when no contract is found.
    const cascade = resolveContractForCOG(
      {
        vendorItemNo: r.vendorItemNo,
        vendorId: r.vendorId,
        transactionDate: r.transactionDate,
        vendorName: r.vendorName,
      },
      resolveCtx,
    )

    // Mode → persisted COGMatchStatus (§ Task 5, Step 4):
    //   vendorItemNo / vendorAndDate  → on_contract (refined by variance below)
    //   fuzzyVendorName               → on_contract (no fuzzy enum in schema;
    //                                   closest available is on_contract)
    //   none                          → delegated below to matchCOGRecordToContract
    //                                   for off_contract_item / out_of_scope /
    //                                   unknown_vendor differentiation.
    const result = matchCOGRecordToContract(
      {
        facilityId: r.facilityId,
        vendorId: r.vendorId,
        vendorName: r.vendorName,
        vendorItemNo: r.vendorItemNo,
        unitCost: Number(r.unitCost),
        quantity: r.quantity,
        transactionDate: r.transactionDate,
        // W1.W-C4: include category so specific_category terms are respected.
        category: r.category,
      },
      contracts,
    )

    // If the cascade found a contract via vendor+date or fuzzy-name but the
    // strict item-level matcher returned off_contract_item (e.g. the
    // contract has zero ContractPricing rows, or the vendorItemNo simply
    // isn't on the contract line-sheet), trust the weaker cascade signal
    // and classify the row as on_contract against that contractId.
    //
    // Without this override the match cascade's steps 2 & 3 have no effect:
    // `matchCOGRecordToContract` only returns on_contract/price_variance
    // when a pricingItems row matches, which defeats the whole purpose of
    // a cascade fallback.
    const effectiveResult: MatchResult =
      result.status === "off_contract_item" &&
      cascade.contractId !== null &&
      (cascade.mode === "vendorAndDate" || cascade.mode === "fuzzyVendorName")
        ? { status: "on_contract", contractId: cascade.contractId, contractPrice: 0, savings: 0 }
        : result

    const cols = enrichCOGRecord(effectiveResult, {
      quantity: r.quantity,
      unitCost: Number(r.unitCost),
    })

    // When we took the cascade override, null out contractPrice (we have no
    // authoritative price) rather than persisting the sentinel 0.
    if (effectiveResult !== result && effectiveResult.status === "on_contract") {
      cols.contractPrice = null
      cols.savingsAmount = null
    }

    // Charles iMessage 2026-04-20 N15: "category from that pricing
    // file needs to map to the COG data." When we match a COG row to
    // a pricing row AND the COG row has no category of its own, copy
    // the pricing row's category across. Never OVERWRITE a COG-supplied
    // category — source-of-truth preference is: COG-imported value >
    // pricing-file fallback.
    const matchedCategory =
      (effectiveResult.status === "on_contract" ||
        effectiveResult.status === "price_variance") &&
      (effectiveResult as { matchedCategory?: string | null })
        .matchedCategory
    const shouldFillCategory =
      (r.category == null || r.category === "") &&
      typeof matchedCategory === "string" &&
      matchedCategory.length > 0

    pendingUpdates.push(
      db.cOGRecord.update({
        where: { id: r.id },
        data: {
          matchStatus: cols.matchStatus,
          contractId: cols.contractId,
          contractPrice: cols.contractPrice === null ? null : cols.contractPrice,
          isOnContract: cols.isOnContract,
          savingsAmount: cols.savingsAmount === null ? null : cols.savingsAmount,
          variancePercent: cols.variancePercent === null ? null : cols.variancePercent,
          ...(shouldFillCategory ? { category: matchedCategory } : {}),
        },
      }),
    )

    updated++
    processedSinceLog++
    processedTotal++
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

    if (pendingUpdates.length >= BATCH_SIZE) {
      await flush()
    }
    if (processedSinceLog >= 1000) {
      console.log(
        `[recompute] vendor=${vendorId} facility=${facilityId} processed=${processedTotal}/${records.length}`,
      )
      processedSinceLog = 0
    }
  }

  await flush()
  if (records.length > 0) {
    console.log(
      `[recompute] vendor=${vendorId} facility=${facilityId} done — ${updated} updated (on_contract=${onContract}, price_variance=${priceVariance}, off_contract=${offContract}, out_of_scope=${outOfScope}, unknown_vendor=${unknownVendor})`,
    )
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
