import { requireVendor } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorReportsClient } from "@/components/vendor/reports-client"

export default async function VendorReportsPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Generate and download performance and compliance reports"
      />
      <VendorReportsClient vendorId={vendor.id} />
    </div>
  )
}
