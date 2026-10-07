import { requireVendor } from "@/lib/actions/auth"
import { getVendorRelatedFacilities } from "@/lib/actions/vendor-prospective"
import { VendorProspectiveClient } from "./prospective-client"

export default async function VendorProspectivePage() {
  const { vendor } = await requireVendor()

  // Audit M5: scope the facility list to facilities this vendor has a
  // real relationship with (contract incl. grouped additionalVendorIds
  // membership, COG sales history, or a PendingContract) — previously
  // this listed EVERY active facility on the platform. An empty list is
  // fine: the proposal builder still allows custom facility names, and
  // the Deal Scorer shows an honest empty hint.
  const facilities = await getVendorRelatedFacilities()

  return <VendorProspectiveClient vendorId={vendor.id} facilities={facilities} />
}
