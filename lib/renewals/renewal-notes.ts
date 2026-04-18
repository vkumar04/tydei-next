/**
 * Renewals — notes validation + sort helpers.
 *
 * Reference: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2
 *
 * Pure — no DB calls. Used by `listRenewalNotes` / `createRenewalNote`
 * server actions for shape validation + sort.
 */

export interface RenewalNoteInput {
  contractId: string
  note: string
  /** Optional caller-provided author id for test mocks. */
  authorId?: string | null
}

export interface ValidatedRenewalNote {
  contractId: string
  note: string
  authorId: string | null
}

export class RenewalNoteValidationError extends Error {
  constructor(
    public field: string,
    public reason: string,
  ) {
    super(`Invalid renewal note: ${field} — ${reason}`)
  }
}

/**
 * Validate + normalize a renewal-note input. Trims the note,
 * rejects empty or over-long payloads.
 */
export function validateRenewalNote(
  input: unknown,
): ValidatedRenewalNote {
  if (input === null || typeof input !== "object") {
    throw new RenewalNoteValidationError("input", "expected object")
  }
  const rec = input as Record<string, unknown>

  if (typeof rec.contractId !== "string" || rec.contractId.trim().length === 0) {
    throw new RenewalNoteValidationError(
      "contractId",
      "required non-empty string",
    )
  }

  if (typeof rec.note !== "string") {
    throw new RenewalNoteValidationError("note", "required string")
  }
  const trimmed = rec.note.trim()
  if (trimmed.length === 0) {
    throw new RenewalNoteValidationError("note", "cannot be empty")
  }
  if (trimmed.length > 5000) {
    throw new RenewalNoteValidationError(
      "note",
      `too long (max 5000 chars, got ${trimmed.length})`,
    )
  }

  const authorId =
    typeof rec.authorId === "string" && rec.authorId.length > 0
      ? rec.authorId
      : null

  return {
    contractId: rec.contractId.trim(),
    note: trimmed,
    authorId,
  }
}

export interface RenewalNote {
  id: string
  contractId: string
  note: string
  authorId: string | null
  createdAt: Date
}

/**
 * Sort notes newest-first. Stable for ties on createdAt (falls back
 * to id descending for deterministic test assertions).
 */
export function sortNotesNewestFirst<T extends RenewalNote>(notes: T[]): T[] {
  return [...notes].sort((a, b) => {
    const ms = b.createdAt.getTime() - a.createdAt.getTime()
    if (ms !== 0) return ms
    return b.id.localeCompare(a.id)
  })
}
