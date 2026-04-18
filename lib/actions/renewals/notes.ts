"use server"

/**
 * Renewals — renewal-note server actions.
 *
 * Reference: docs/superpowers/specs/2026-04-18-renewals-rewrite.md §4.2
 *
 * Wires the pure helpers in `lib/renewals/renewal-notes.ts` to Prisma +
 * facility ownership guards + audit log. All write paths emit audit rows
 * so deletes/creates are traceable.
 *
 * Ownership model:
 *   - The note's contract must be owned by (or shared with) the caller's
 *     facility — enforced via `contractOwnershipWhere`.
 *   - For delete: only the original author may delete their note. Broader
 *     "facility admin" override is intentionally deferred — we have no
 *     `facility_admin` role flag yet in the schema, so conditioning on
 *     authorId is the safer v1. Widening this is a single-line change
 *     when the role system grows.
 */

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import {
  validateRenewalNote,
  sortNotesNewestFirst,
  type RenewalNote,
} from "@/lib/renewals/renewal-notes"

// ─── List ────────────────────────────────────────────────────────

export async function listRenewalNotes(
  contractId: string,
): Promise<RenewalNote[]> {
  const { facility } = await requireFacility()

  // Verify ownership before listing. findFirst returns null when the
  // contract isn't owned/shared — we treat that as "no notes" rather
  // than throwing, to match the pattern other list actions use.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  if (!contract) return []

  const rows = await prisma.renewalNote.findMany({
    where: { contractId },
  })

  const serialized = serialize(
    rows.map((r) => ({
      id: r.id,
      contractId: r.contractId,
      note: r.note,
      authorId: r.authorId,
      createdAt: r.createdAt,
    })),
  ) as RenewalNote[]

  // sortNotesNewestFirst compares via Date#getTime — re-hydrate Date
  // from the serialized ISO string so the sort is deterministic.
  const withDates: RenewalNote[] = serialized.map((n) => ({
    ...n,
    createdAt: new Date(n.createdAt as unknown as string),
  }))

  return sortNotesNewestFirst(withDates)
}

// ─── Create ──────────────────────────────────────────────────────

export async function createRenewalNote(input: {
  contractId: string
  note: string
}): Promise<RenewalNote> {
  const { facility, user } = await requireFacility()

  const validated = validateRenewalNote(input)

  // Ownership check — throw explicitly so the UI shows a clear error
  // rather than silently dropping the note.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(validated.contractId, facility.id),
    select: { id: true },
  })
  if (!contract) {
    throw new Error("Contract not found")
  }

  const created = await prisma.renewalNote.create({
    data: {
      contractId: validated.contractId,
      note: validated.note,
      authorId: user.id,
    },
  })

  await logAudit({
    userId: user.id,
    action: "renewal.note_created",
    entityType: "renewal_note",
    entityId: created.id,
    metadata: {
      contractId: validated.contractId,
      noteLength: validated.note.length,
    },
  })

  return serialize({
    id: created.id,
    contractId: created.contractId,
    note: created.note,
    authorId: created.authorId,
    createdAt: created.createdAt,
  }) as RenewalNote
}

// ─── Delete ──────────────────────────────────────────────────────

export async function deleteRenewalNote(id: string): Promise<void> {
  const { facility, user } = await requireFacility()

  const note = await prisma.renewalNote.findUnique({
    where: { id },
    select: {
      id: true,
      contractId: true,
      authorId: true,
    },
  })
  if (!note) {
    throw new Error("Renewal note not found")
  }

  // Ownership: facility must own the contract this note attaches to.
  const contract = await prisma.contract.findFirst({
    where: contractOwnershipWhere(note.contractId, facility.id),
    select: { id: true },
  })
  if (!contract) {
    throw new Error("Renewal note not found")
  }

  // Author-only delete. When the facility role system gains an admin
  // flag, widen this to `note.authorId === user.id || isFacilityAdmin`.
  if (note.authorId !== user.id) {
    throw new Error("Only the note's author can delete it")
  }

  await prisma.renewalNote.delete({ where: { id: note.id } })

  await logAudit({
    userId: user.id,
    action: "renewal.note_deleted",
    entityType: "renewal_note",
    entityId: note.id,
    metadata: {
      contractId: note.contractId,
    },
  })
}
