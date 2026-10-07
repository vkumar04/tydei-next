import { requireVendor } from "@/lib/actions/auth"
import { getVendorRelatedFacilities } from "@/lib/actions/vendor-prospective"
import { VendorReportsClient } from "@/components/vendor/reports-client"

export default async function VendorReportsPage() {
  const { vendor } = await requireVendor()

  // Real facilities this vendor does business with (contracts incl.
  // grouped membership, COG history, PendingContract) — drives the
  // Facility filter. Previously the control bar hardcoded three mock
  // hospitals (FirstHealth / Memorial / Clearwater), so the actual
  // demo facility (Lighthouse Surgical Center) never appeared. Vick
  // 2026-06-15 "Lighthouse … is not on the list to be able to create a
  // report."
  const facilities = await getVendorRelatedFacilities()

  return <VendorReportsClient vendorId={vendor.id} facilities={facilities} />
}
