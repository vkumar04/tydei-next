import { requireVendor } from "@/lib/actions/auth"
import { VendorRenewalsClient } from "@/components/vendor/renewals/vendor-renewals-client"

export default async function VendorRenewalsPage() {
  const { vendor } = await requireVendor()

  return <VendorRenewalsClient vendorId={vendor.id} />
}
