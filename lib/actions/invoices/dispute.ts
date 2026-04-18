"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"

// ─── Flag Invoice as Disputed ───────────────────────────────────
//
// Facility-side action: marks an invoice as disputed, records a note,
// stamps the dispute time, and writes an audit trail entry. Vendor-side
// resolution surface ships in the vendor-transactions spec; this action
// only updates internal state + audit log.

export async function flagInvoiceAsDisputed(input: {
  invoiceId: string
  note: string
}) {
  const { facility, user } = await requireFacility()

  const note = input.note?.trim() ?? ""
  if (note.length === 0) {
    throw new Error("Dispute note is required")
  }

  // Ownership check — scope invoice to this facility.
  const existing = await prisma.invoice.findUnique({
    where: { id: input.invoiceId, facilityId: facility.id },
    select: { id: true, invoiceNumber: true },
  })
  if (!existing) {
    throw new Error("Invoice not found")
  }

  const updated = await prisma.invoice.update({
    where: { id: existing.id },
    data: {
      disputeStatus: "disputed",
      disputeNote: note,
      disputeAt: new Date(),
    },
  })

  await logAudit({
    userId: user.id,
    action: "invoice.flagged_disputed",
    entityType: "invoice",
    entityId: existing.id,
    metadata: {
      invoiceNumber: existing.invoiceNumber,
      noteLength: note.length,
    },
  })

  revalidatePath("/dashboard/invoice-validation")

  return serialize(updated)
}

// ─── Resolve / Reject an Existing Dispute ───────────────────────
//
// Transitions an invoice from disputeStatus="disputed" → "resolved"
// or "rejected". Optional resolution note is appended to the existing
// disputeNote (preserving original narrative).

export async function resolveInvoiceDispute(input: {
  invoiceId: string
  resolution: "resolved" | "rejected"
  note?: string
}) {
  const { facility, user } = await requireFacility()

  // Ownership check + current-status guard.
  const existing = await prisma.invoice.findUnique({
    where: { id: input.invoiceId, facilityId: facility.id },
    select: {
      id: true,
      invoiceNumber: true,
      disputeStatus: true,
      disputeNote: true,
    },
  })
  if (!existing) {
    throw new Error("Invoice not found")
  }
  if (existing.disputeStatus !== "disputed") {
    throw new Error("Only disputed invoices can be resolved")
  }

  const resolutionNote = input.note?.trim()
  const combinedNote =
    resolutionNote && resolutionNote.length > 0
      ? `${existing.disputeNote ?? ""}\nResolution: ${resolutionNote}`.trim()
      : existing.disputeNote

  const updated = await prisma.invoice.update({
    where: { id: existing.id },
    data: {
      disputeStatus: input.resolution,
      disputeNote: combinedNote,
    },
  })

  const action =
    input.resolution === "resolved"
      ? "invoice.dispute_resolved"
      : "invoice.dispute_rejected"

  await logAudit({
    userId: user.id,
    action,
    entityType: "invoice",
    entityId: existing.id,
    metadata: {
      invoiceNumber: existing.invoiceNumber,
      resolution: input.resolution,
      hasNote: Boolean(resolutionNote && resolutionNote.length > 0),
    },
  })

  revalidatePath("/dashboard/invoice-validation")

  return serialize(updated)
}
