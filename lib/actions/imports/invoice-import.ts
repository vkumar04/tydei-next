"use server"

/**
 * Ingest AI-extracted invoices (minimal).
 *
 * Extracted from lib/actions/mass-upload.ts during F16 tech debt split.
 */
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import { findOrCreateVendorByName, toSafeDate } from "./shared"

export type IngestInvoiceInput = {
  invoiceNumber: string | null
  vendorName: string | null
  invoiceDate: string | null
  totalAmount: number | null
  sourceFilename?: string
}

export type IngestInvoiceResult =
  | { ok: true; invoiceId: string; invoiceNumber: string }
  | { ok: false; error: string; invoiceNumber: string }

export async function ingestExtractedInvoices(
  items: IngestInvoiceInput[],
): Promise<{
  created: number
  failed: number
  results: IngestInvoiceResult[]
}> {
  const session = await requireFacility()
  const facilityId = session.facility.id
  const userId = session.user.id

  const results: IngestInvoiceResult[] = []

  for (const item of items) {
    const displayNumber =
      item.invoiceNumber ||
      item.sourceFilename?.replace(/\.[^/.]+$/, "") ||
      `INV-${Date.now()}-${results.length}`

    try {
      const vendorId = await findOrCreateVendorByName(item.vendorName)
      const invoiceDate = toSafeDate(item.invoiceDate, new Date())

      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber: displayNumber,
          facilityId,
          vendorId,
          invoiceDate,
          totalInvoiceCost: item.totalAmount ?? 0,
          status: "pending",
        },
        select: { id: true, invoiceNumber: true },
      })

      await logAudit({
        userId,
        action: "invoice.imported_via_mass_upload",
        entityType: "invoice",
        entityId: invoice.id,
        metadata: {
          vendorName: item.vendorName,
          sourceFilename: item.sourceFilename ?? null,
        },
      })

      results.push({
        ok: true,
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      results.push({
        ok: false,
        error: message.slice(0, 200),
        invoiceNumber: displayNumber,
      })
    }
  }

  revalidatePath("/dashboard/invoice-validation")
  revalidatePath("/dashboard")

  const created = results.filter((r) => r.ok).length
  const failed = results.length - created
  return serialize({ created, failed, results })
}
