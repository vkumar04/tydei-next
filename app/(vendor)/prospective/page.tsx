import { requireVendor } from "@/lib/actions/auth"
import { VendorProspectiveClient } from "./prospective-client"

export default async function VendorProspectivePage() {
  const { vendor } = await requireVendor()

  return <VendorProspectiveClient vendorId={vendor.id} />
}
