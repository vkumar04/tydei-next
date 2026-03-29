import { requireVendor } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorInvoiceList } from "@/components/vendor/invoices/vendor-invoice-list"

export default async function VendorInvoicesPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description="Submit and track invoices to facilities with automatic contract validation"
      />
      <VendorInvoiceList vendorId={vendor.id} />
    </div>
  )
}
