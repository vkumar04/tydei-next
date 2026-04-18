/**
 * Renewals — vendor proposal review helpers.
 *
 * Reference: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2
 *
 * Pure helpers for the vendor-side "submit renewal proposal" flow +
 * facility-side "review renewal proposal" flow. No DB; server action
 * wiring persists through `ContractChangeProposal` (see
 * lib/ai/contract-change-proposal.ts).
 */

export type ProposalDecision = "approved" | "rejected" | "countered"

export interface ProposedTermsInput {
  /** Proposed effective period. */
  effectiveDate: string | Date | null
  expirationDate: string | Date | null
  /** Proposed pricing delta (signed percent from current, e.g. -5 for 5% reduction). */
  priceChangePercent?: number | null
  /** Proposed rebate-rate delta (signed percent from current). */
  rebateRateChangePercent?: number | null
  /** Free-text summary of non-pricing changes. */
  narrative?: string | null
}

export interface ValidatedProposedTerms {
  effectiveDate: Date | null
  expirationDate: Date | null
  priceChangePercent: number | null
  rebateRateChangePercent: number | null
  narrative: string | null
}

export class ProposalValidationError extends Error {
  constructor(
    public field: string,
    public reason: string,
  ) {
    super(`Invalid proposed terms: ${field} — ${reason}`)
  }
}

function parseDate(v: string | Date | null): Date | null {
  if (v === null || v === undefined) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v
  if (typeof v === "string" && v.trim().length > 0) {
    const d = new Date(v)
    return Number.isNaN(d.getTime()) ? null : d
  }
  return null
}

/**
 * Validate + normalize a proposed-terms input payload.
 */
export function validateProposedTerms(
  input: unknown,
): ValidatedProposedTerms {
  if (input === null || typeof input !== "object") {
    throw new ProposalValidationError("input", "expected object")
  }
  const rec = input as Record<string, unknown>

  const effectiveDate = parseDate(rec.effectiveDate as string | Date | null)
  const expirationDate = parseDate(rec.expirationDate as string | Date | null)

  // Expiration must be after effective when both set.
  if (effectiveDate && expirationDate && expirationDate <= effectiveDate) {
    throw new ProposalValidationError(
      "expirationDate",
      "must be strictly after effectiveDate",
    )
  }

  const priceChangePercent =
    rec.priceChangePercent === null || rec.priceChangePercent === undefined
      ? null
      : Number(rec.priceChangePercent)
  if (priceChangePercent !== null && !Number.isFinite(priceChangePercent)) {
    throw new ProposalValidationError(
      "priceChangePercent",
      "must be a finite number",
    )
  }
  // Reasonable bounds — reject absurd proposals
  if (priceChangePercent !== null && Math.abs(priceChangePercent) > 100) {
    throw new ProposalValidationError(
      "priceChangePercent",
      "out of range (|%| must be ≤ 100)",
    )
  }

  const rebateRateChangePercent =
    rec.rebateRateChangePercent === null ||
    rec.rebateRateChangePercent === undefined
      ? null
      : Number(rec.rebateRateChangePercent)
  if (
    rebateRateChangePercent !== null &&
    !Number.isFinite(rebateRateChangePercent)
  ) {
    throw new ProposalValidationError(
      "rebateRateChangePercent",
      "must be a finite number",
    )
  }
  if (
    rebateRateChangePercent !== null &&
    Math.abs(rebateRateChangePercent) > 100
  ) {
    throw new ProposalValidationError(
      "rebateRateChangePercent",
      "out of range (|%| must be ≤ 100)",
    )
  }

  const narrative =
    typeof rec.narrative === "string" && rec.narrative.trim().length > 0
      ? rec.narrative.trim()
      : null

  return {
    effectiveDate,
    expirationDate,
    priceChangePercent,
    rebateRateChangePercent,
    narrative,
  }
}

export interface ReviewDecisionInput {
  decision: ProposalDecision
  note: string
}

export interface ValidatedReviewDecision {
  decision: ProposalDecision
  note: string
}

/**
 * Validate a facility-side review decision payload.
 * - countered + rejected require a note (min 10 chars)
 * - approved can have optional note
 */
export function validateReviewDecision(
  input: unknown,
): ValidatedReviewDecision {
  if (input === null || typeof input !== "object") {
    throw new ProposalValidationError("input", "expected object")
  }
  const rec = input as Record<string, unknown>

  const decision = rec.decision
  if (
    typeof decision !== "string" ||
    !["approved", "rejected", "countered"].includes(decision)
  ) {
    throw new ProposalValidationError(
      "decision",
      "must be 'approved', 'rejected', or 'countered'",
    )
  }

  const note = typeof rec.note === "string" ? rec.note.trim() : ""

  if ((decision === "rejected" || decision === "countered") && note.length < 10) {
    throw new ProposalValidationError(
      "note",
      `${decision} requires a note ≥ 10 characters`,
    )
  }

  return {
    decision: decision as ProposalDecision,
    note,
  }
}
