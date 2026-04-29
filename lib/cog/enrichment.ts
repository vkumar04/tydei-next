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
      const rawSavings =
        (result.contractPrice - record.unitCost) * record.quantity
      // Clamp to the `Decimal(6,2)` range the schema allows. Real-world data
      // occasionally has extreme mismatches (placeholder $0 contract prices,
      // wildly stale XLSX prices, etc.) that compute to millions-of-percent
      // variance — the field overflows and the whole pipeline fails. Clamping
      // preserves the signal ("very far off") without crashing the recompute.
      const VARIANCE_CLAMP = 9999.99
      const clampedVariance = Math.max(
        -VARIANCE_CLAMP,
        Math.min(VARIANCE_CLAMP, result.variancePercent),
      )

      // Charles 2026-04-29: kit-vs-component sanity cap. When the
      // matched contract price is many multiples of the actual unit
      // cost (e.g., contract row is for a kit, COG row is for a single
      // component), the algebraic identity
      //     savings/extended = contractPrice/unitCost - 1
      // produces a fictional "+$946 saved" on a $37 line. That number
      // is a false positive — there's no real savings, the matcher
      // just compared apples to oranges.
      //
      // When |savings/extended| > SAVINGS_RATIO_SANITY, null out the
      // savings claim. The variance percent is still surfaced so the
      // user sees "something is off"; we just don't fabricate a
      // dollar number. SANITY=10 means we tolerate up to a 10×
      // overpay/discount, which covers any real contract dispute
      // while flagging unit-mismatch as untrusted.
      const SAVINGS_RATIO_SANITY = 10
      const extendedPrice = record.unitCost * record.quantity
      const ratio =
        extendedPrice > 0 ? Math.abs(rawSavings) / extendedPrice : Infinity
      const savings =
        ratio > SAVINGS_RATIO_SANITY ? null : rawSavings
      return {
        matchStatus: "price_variance",
        contractId: result.contractId,
        contractPrice: result.contractPrice,
        isOnContract: false, // variance means NOT on contract cleanly
        savingsAmount: savings,
        variancePercent: clampedVariance,
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
