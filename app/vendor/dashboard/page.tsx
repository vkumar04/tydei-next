import { requireVendor } from "@/lib/actions/auth"
import { VendorDashboardClient } from "@/components/vendor/dashboard/vendor-dashboard-client"

export default async function VendorDashboard() {
  const { vendor } = await requireVendor()

  return (
    <VendorDashboardClient
      vendorId={vendor.id}
      vendorName={vendor.name}
    />
  )
}
