/**
 * Canonical COG → Contract cascade resolver.
 *
 * Per v0-parity wave 3, subsystem 10.5. Pure function; callers build the
 * lookup maps once per recompute and pass them in.
 *
 * Cascade (cheapest → fuzziest):
 *   1. Exact `vendorItemNo` against active contract pricing within date window.
 *   2. Exact `vendorId` + `transactionDate` within an active contract window.
 *   3. Fuzzy vendor-name match (legacy fallback) + active contract window.
 *
 * Returns `{ contractId, mode }`. Caller decides how to translate `mode`
 * into the persisted `COGMatchStatus` enum (see lib/cog/recompute.ts).
 */

import type { COGRecord } from "@prisma/client"

export type MatchMode =
  | "vendorItemNo"
  | "vendorAndDate"
  | "fuzzyVendorName"
  | "none"

export interface MatchResult {
  contractId: string | null
  mode: MatchMode
}

export interface PricingCandidate {
  contractId: string
  effectiveStart: Date
  effectiveEnd: Date
}

export interface ContractCandidate {
  id: string
  effectiveDate: Date
  expirationDate: Date
}

export interface ResolveContext {
  /** Keyed by exact vendorItemNo string (case folding is the caller's choice). */
  pricingByVendorItem: Map<string, PricingCandidate[]>
  /** Keyed by vendorId → all active contracts for that vendor. */
  activeContractsByVendor: Map<string, ContractCandidate[]>
  /**
   * Fuzzy vendor-name → vendorId. Should consult any alias tables +
   * Levenshtein-style similarity. Pass `() => null` to skip the fuzzy
   * step (e.g. when an import pipeline has already resolved vendor ids).
   */
  fuzzyVendorMatch: (name: string) => string | null
}

type Row = Pick<
  COGRecord,
  "vendorItemNo" | "vendorId" | "transactionDate" | "vendorName"
>

/**
 * Cascade resolver. Tries in order:
 *   1. Exact vendorItemNo match against active contract pricing.
 *   2. Exact vendorId + transactionDate within active contract window.
 *   3. Fuzzy vendor-name match (legacy fallback).
 *
 * Each step is bounded by the record's `transactionDate` — a contract
 * only counts if the transaction falls within its effective window.
 */
export function resolveContractForCOG(
  row: Row,
  ctx: ResolveContext,
): MatchResult {
  if (!row.transactionDate) return { contractId: null, mode: "none" }
  const txMs = row.transactionDate.getTime()

  // 1. vendorItemNo
  if (row.vendorItemNo) {
    const candidates = ctx.pricingByVendorItem.get(row.vendorItemNo) ?? []
    const hit = candidates.find(
      (c) =>
        txMs >= c.effectiveStart.getTime() && txMs <= c.effectiveEnd.getTime(),
    )
    if (hit) return { contractId: hit.contractId, mode: "vendorItemNo" }
  }

  // 2. vendorId + date window
  if (row.vendorId) {
    const candidates = ctx.activeContractsByVendor.get(row.vendorId) ?? []
    const hit = candidates.find(
      (c) =>
        txMs >= c.effectiveDate.getTime() &&
        txMs <= c.expirationDate.getTime(),
    )
    if (hit) return { contractId: hit.id, mode: "vendorAndDate" }
  }

  // 3. fuzzy vendor-name
  if (row.vendorName) {
    const fuzzyVendorId = ctx.fuzzyVendorMatch(row.vendorName)
    if (fuzzyVendorId) {
      const candidates = ctx.activeContractsByVendor.get(fuzzyVendorId) ?? []
      const hit = candidates.find(
        (c) =>
          txMs >= c.effectiveDate.getTime() &&
          txMs <= c.expirationDate.getTime(),
      )
      if (hit) return { contractId: hit.id, mode: "fuzzyVendorName" }
    }
  }

  return { contractId: null, mode: "none" }
}
