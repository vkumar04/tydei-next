/**
 * Data pipeline — invoice dispute note templates.
 *
 * Reference: docs/superpowers/specs/2026-04-18-data-pipeline-rewrite.md §4.3
 *
 * Pure string builders that produce standardized dispute note prefixes
 * so every dispute has a consistent, scannable format for the vendor
 * + audit log.
 */

export type DisputeReason =
  | "price_overcharge"
  | "quantity_mismatch"
  | "off_contract_item"
  | "duplicate_charge"
  | "missing_credit"
  | "other"

export interface DisputeTemplateInput {
  reason: DisputeReason
  /** Optional amount-at-issue — renders as "($X.XX)" in the prefix when set. */
  amount?: number | null
  /** Optional line-level reference, e.g. invoice line number or vendorItemNo. */
  lineReference?: string | null
  /** Free-text user note. Required. */
  userNote: string
}

const REASON_LABELS: Record<DisputeReason, string> = {
  price_overcharge: "Price overcharge",
  quantity_mismatch: "Quantity mismatch",
  off_contract_item: "Off-contract item",
  duplicate_charge: "Duplicate charge",
  missing_credit: "Missing credit",
  other: "Other",
}

/**
 * Build a structured dispute note. Format:
 *
 *   [{reason label}] ({amount}) [line: {ref}] {userNote}
 *
 * Only includes the optional segments when provided.
 */
export function buildDisputeNote(input: DisputeTemplateInput): string {
  const parts: string[] = [`[${REASON_LABELS[input.reason]}]`]
  if (input.amount !== null && input.amount !== undefined) {
    parts.push(`($${input.amount.toFixed(2)})`)
  }
  if (input.lineReference && input.lineReference.trim().length > 0) {
    parts.push(`[line: ${input.lineReference.trim()}]`)
  }
  const userNote = input.userNote.trim()
  if (userNote.length > 0) {
    parts.push(userNote)
  }
  return parts.join(" ")
}

/**
 * Parse a note built by buildDisputeNote back into its input shape.
 * Returns null when the note doesn't start with a recognized reason
 * prefix (i.e., was entered freeform in the legacy UI).
 */
export function parseDisputeNote(
  note: string,
): DisputeTemplateInput | null {
  const trimmed = note.trim()
  const reasonMatch = trimmed.match(/^\[([^\]]+)\]/)
  if (!reasonMatch) return null

  const label = reasonMatch[1]
  const reasonEntry = Object.entries(REASON_LABELS).find(
    ([, l]) => l === label,
  )
  if (!reasonEntry) return null
  const reason = reasonEntry[0] as DisputeReason

  let rest = trimmed.slice(reasonMatch[0].length).trim()

  // Amount: "($X.XX)"
  let amount: number | null = null
  const amountMatch = rest.match(/^\(\$([\d.]+)\)/)
  if (amountMatch) {
    amount = Number.parseFloat(amountMatch[1])
    rest = rest.slice(amountMatch[0].length).trim()
  }

  // Line ref: "[line: XYZ]"
  let lineReference: string | null = null
  const lineMatch = rest.match(/^\[line:\s*([^\]]+)\]/)
  if (lineMatch) {
    lineReference = lineMatch[1].trim()
    rest = rest.slice(lineMatch[0].length).trim()
  }

  return {
    reason,
    amount,
    lineReference,
    userNote: rest,
  }
}
