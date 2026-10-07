import { requireFacility } from "@/lib/actions/auth"
import { getInvoice, validateInvoice } from "@/lib/actions/invoices"
import { PageHeader } from "@/components/shared/page-header"
import { InvoiceValidationDetail } from "@/components/facility/invoices/invoice-validation-detail"

interface Props {
  params: Promise<{ id: string }>
}

export default async function InvoiceDetailPage({ params }: Props) {
  await requireFacility()
  const { id } = await params
  const [invoice, validation] = await Promise.all([
    getInvoice(id),
    validateInvoice(id),
  ])

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Invoice ${invoice.invoiceNumber}`}
        description={`${invoice.vendor.name} - Validation results`}
      />
      <InvoiceValidationDetail
        invoiceId={id}
        validation={validation}
        invoice={{
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          vendorName: invoice.vendor.name,
          disputeStatus:
            (invoice.disputeStatus as
              | "none"
              | "disputed"
              | "resolved"
              | "rejected"
              | undefined) ?? "none",
          disputeNote: invoice.disputeNote ?? null,
          totalInvoiceCost: Number(invoice.totalInvoiceCost ?? 0),
        }}
      />
    </div>
  )
}
