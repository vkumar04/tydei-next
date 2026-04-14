import { requireVendor } from "@/lib/actions/auth"
import { VendorInvoiceList } from "@/components/vendor/invoices/vendor-invoice-list"

export default async function VendorInvoicesPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="flex flex-col gap-6">
      {/* Header — v0 parity: inline <h1>, no PageHeader wrapper */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-balance">Invoices</h1>
        <p className="text-muted-foreground">
          Submit and track invoices to facilities with automatic contract validation
        </p>
      </div>
      <VendorInvoiceList vendorId={vendor.id} />
    </div>
  )
}
