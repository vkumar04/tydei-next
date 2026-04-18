/**
 * COG enrichment adapter.
 *
 * Pure function — maps a MatchResult (from lib/contracts/match.ts) plus
 * the COG record's quantity/unitCost into the 5 persisted columns:
 *
 *   matchStatus, contractId, contractPrice,
 *   isOnContract, savingsAmount, variancePercent
 *
 * ─── Sign convention (LOCKED IN, §4.11) ─────────────────────────────
 *
 *   savingsAmount > 0      → facility paid LESS than contract (win)
 *   variancePercent > 0    → facility paid MORE than contract (bad)
 *   isOnContract === true  → status is exactly "on_contract" (within 2%)
 *
 * This is the only module that writes enrichment columns. Subsystem 2's
 * recompute trigger, subsystem 3's import pipeline, and subsystem 4's
 * duplicate detection all go through this function — there must be
 * exactly one place where the sign lives.
 */

import type { COGMatchStatus, Prisma } from "@prisma/client"
import type { MatchResult } from "@/lib/contracts/match"

export type EnrichmentColumns = {
  matchStatus: COGMatchStatus
  contractId: string | null
  contractPrice: Prisma.Decimal | number | null
  isOnContract: boolean
  savingsAmount: Prisma.Decimal | number | null
  variancePercent: Prisma.Decimal | number | null
}

export type RecordForEnrichment = {
  quantity: number
  unitCost: number
}

/**
 * Map a single MatchResult + record into the 5 enrichment columns.
 */
export function enrichCOGRecord(
  result: MatchResult,
  record: RecordForEnrichment,
): EnrichmentColumns {
  switch (result.status) {
    case "unknown_vendor":
    case "off_contract_item":
    case "out_of_scope":
      return {
        matchStatus: result.status,
        contractId: null,
        contractPrice: null,
        isOnContract: false,
        savingsAmount: null,
        variancePercent: null,
      }

    case "on_contract":
      return {
        matchStatus: "on_contract",
        contractId: result.contractId,
        contractPrice: result.contractPrice,
        isOnContract: true,
        savingsAmount: result.savings,
        variancePercent: 0,
      }

    case "price_variance": {
      // savingsAmount for a variance record: (contract - actual) × quantity.
      // If facility overpaid (variancePercent > 0), savings will be negative.
      const savings = (result.contractPrice - record.unitCost) * record.quantity
      return {
        matchStatus: "price_variance",
        contractId: result.contractId,
        contractPrice: result.contractPrice,
        isOnContract: false, // variance means NOT on contract cleanly
        savingsAmount: savings,
        variancePercent: result.variancePercent,
      }
    }
  }
}

/**
 * Batched version: preserve input order, return enrichment per row.
 */
export function enrichBatch(
  pairs: Array<{ result: MatchResult; record: RecordForEnrichment }>,
): EnrichmentColumns[] {
  return pairs.map(({ result, record }) => enrichCOGRecord(result, record))
}
