import { requireVendor } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorPurchaseOrdersClient } from "@/components/vendor/purchase-orders-client"

export default async function VendorPurchaseOrdersPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="space-y-6">
      <PageHeader title="Purchase Orders" description="View purchase orders from your facilities" />
      <VendorPurchaseOrdersClient vendorId={vendor.id} />
    </div>
  )
}
