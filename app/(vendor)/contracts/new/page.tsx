import { requireVendor } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/shared/page-header"
import { VendorContractSubmission } from "@/components/vendor/contracts/vendor-contract-submission"

export default async function NewVendorContractPage() {
  const { vendor } = await requireVendor()

  const facilities = await prisma.facility.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Submit Contract"
        description="Submit a new contract for facility review"
      />
      <VendorContractSubmission
        vendorId={vendor.id}
        vendorName={vendor.name}
        facilities={facilities}
      />
    </div>
  )
}
