import { requireVendor } from "@/lib/actions/auth"
import { VendorReportsClient } from "@/components/vendor/reports-client"

export default async function VendorReportsPage() {
  const { vendor } = await requireVendor()

  return <VendorReportsClient vendorId={vendor.id} />
}
