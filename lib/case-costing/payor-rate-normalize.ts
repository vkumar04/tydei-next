import type { PayorCptRate } from "./reimbursement-lookup"

/**
 * Canonical `PayorContract.cptRates` JSON -> `PayorCptRate[]` normalization.
 *
 * Extracted from `lib/actions/case-costing/payor-margin.ts` (2026-07-26) for
 * one reason: while it lived inline inside a `"use server"` function that
 * opens with Prisma calls and `requireFacility()`, nothing could test it. It
 * dropped `effectiveDate` for months and the entire suite stayed green —
 * including a parity test written specifically for this bug, because that
 * test reimplemented the mapping instead of calling it.
 *
 * Shape tolerance is deliberate: the seeded payor JSON uses
 * `{cpt, rate}`, the AI extractor emits `{cptCode, rate, effectiveDate}`,
 * and a future migration may use `{cptCode, reimbursement}`. Accept all
 * three rather than making the caller guess.
 *
 * `effectiveFrom` is the field that matters. `lookupReimbursement` uses it
 * twice — `inEffectiveWindow` to reject out-of-window rates, and
 * `pickMostRecent` to choose between years. Supply null for every row and
 * both quietly degrade: every rate matches, the sort key is uniformly 0,
 * and the first row in the JSON wins regardless of the case date.
 */

export interface StoredPayorRate {
  cpt?: string
  cptCode?: string
  rate?: number
  reimbursement?: number
  description?: string
  /**
   * Window start for multi-year contracts, which list one rate per CPT per
   * contract year. Production carries 252 such rows against 84 undated ones.
   */
  effectiveDate?: string | Date | null
  effectiveFrom?: string | Date | null
}

/** Parse a stored effective-date value into a Date, or null. */
export function parseEffectiveFrom(raw: unknown): Date | null {
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw
  if (typeof raw === "string" && raw.trim()) {
    const d = new Date(raw)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

export function normalizePayorCptRates(
  raw: StoredPayorRate[] | null | undefined,
  payorType: string,
): PayorCptRate[] {
  return (raw ?? []).map((r) => ({
    payorType: String(payorType),
    cptCode: String(r.cptCode ?? r.cpt ?? ""),
    reimbursement: Number(r.reimbursement ?? r.rate ?? 0),
    effectiveFrom: parseEffectiveFrom(r.effectiveDate ?? r.effectiveFrom),
  }))
}
