import { requireFacility } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { InvoiceValidationClient } from "@/components/facility/invoices/invoice-validation-client"

export default async function InvoiceValidationPage() {
  const { facility } = await requireFacility()

  const vendors = await prisma.vendor.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return (
    <InvoiceValidationClient
      facilityId={facility.id}
      vendors={vendors}
    />
  )
}
