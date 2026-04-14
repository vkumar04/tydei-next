import { requireVendor } from "@/lib/actions/auth"
import { VendorPurchaseOrdersClient } from "@/components/vendor/purchase-orders-client"

export default async function VendorPurchaseOrdersPage() {
  const { vendor } = await requireVendor()

  return (
    <div className="flex flex-col gap-6">
      {/* Header — v0 parity: inline <h1>, no PageHeader wrapper */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-balance">Purchase Orders</h1>
        <p className="text-muted-foreground">
          View and manage purchase orders from healthcare facilities
        </p>
      </div>
      <VendorPurchaseOrdersClient vendorId={vendor.id} />
    </div>
  )
}
