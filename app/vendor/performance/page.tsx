import { requireVendor } from "@/lib/actions/auth"
import { PerformanceClient } from "@/components/vendor/performance/performance-client"

export default async function VendorPerformancePage() {
  const { vendor } = await requireVendor()

  return <PerformanceClient vendorId={vendor.id} />
}
