"use server"

/**
 * Vendor-side invoice actions. Mirrors lib/actions/vendor-purchase-orders.ts
 * (same auth + relationship-allowlist pattern). Created 2026-04-26 to
 * replace the previous client-only stub in
 * components/vendor/invoices/vendor-invoice-submit-dialog.tsx —
 * which closed the modal but never persisted anything.
 */

import { prisma } from "@/lib/db"
import { requireVendor } from "@/lib/actions/auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import {
  submitVendorInvoiceSchema,
  type SubmitVendorInvoiceInput,
} from "@/lib/validators/vendor-invoices"

export async function submitVendorInvoice(input: SubmitVendorInvoiceInput) {
  const { vendor, user } = await requireVendor()
  const data = submitVendorInvoiceSchema.parse(input)

  // Same relationship gate as createVendorPurchaseOrder's off-contract
  // path: vendors can only invoice facilities where they have a
  // contract OR an existing PO. Prevents cross-tenant invoice spam.
  const hasRelationship =
    (await prisma.contract.count({
      where: { vendorId: vendor.id, facilityId: data.facilityId },
    })) > 0 ||
    (await prisma.purchaseOrder.count({
      where: { vendorId: vendor.id, facilityId: data.facilityId },
    })) > 0
  if (!hasRelationship) {
    throw new Error(
      "No relationship with this facility — invoices are only allowed at facilities you already serve.",
    )
  }

  // Idempotency on (vendorId, invoiceNumber): one vendor's invoice
  // numbers should be unique across their submissions, so a
  // double-submit doesn't create duplicate rows.
  const existing = await prisma.invoice.findFirst({
    where: { vendorId: vendor.id, invoiceNumber: data.invoiceNumber },
    select: { id: true },
  })
  if (existing) {
    throw new Error(
      `Invoice ${data.invoiceNumber} has already been submitted.`,
    )
  }

  const invoice = await prisma.invoice.create({
    data: {
      invoiceNumber: data.invoiceNumber,
      facilityId: data.facilityId,
      vendorId: vendor.id,
      invoiceDate: data.invoiceDate ? new Date(data.invoiceDate) : new Date(),
      totalInvoiceCost: data.totalAmount,
      status: "submitted",
      // Vendor-submitted invoices start without line items; the facility
      // can request line-item detail during validation.
    },
  })

  await logAudit({
    userId: user.id,
    action: "invoice.submitted_by_vendor",
    entityType: "invoice",
    entityId: invoice.id,
    metadata: {
      invoiceNumber: data.invoiceNumber,
      vendorId: vendor.id,
      facilityId: data.facilityId,
      totalCost: data.totalAmount,
    },
  })

  return serialize(invoice)
}
