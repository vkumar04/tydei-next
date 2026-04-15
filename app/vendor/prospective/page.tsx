import { requireVendor } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { VendorProspectiveClient } from "./prospective-client"

export default async function VendorProspectivePage() {
  const { vendor } = await requireVendor()

  // Facilities the vendor can write proposals for — every active facility
  // in the platform. The proposal builder's FacilitySelector was
  // previously receiving an empty array, which silently made it
  // impossible to select a facility and therefore impossible to upload
  // pricing (the Products section won't commit without one).
  const facilities = await prisma.facility.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return <VendorProspectiveClient vendorId={vendor.id} facilities={facilities} />
}
