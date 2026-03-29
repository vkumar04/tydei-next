import { requireFacility } from "@/lib/actions/auth"
import { prisma } from "@/lib/db"
import { PageHeader } from "@/components/shared/page-header"
import { POCreateForm } from "@/components/facility/purchase-orders/po-create-form"

export default async function NewPurchaseOrderPage() {
  const { facility } = await requireFacility()

  const vendors = await prisma.vendor.findMany({
    where: { status: "active" },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })

  return (
    <div className="space-y-6">
      <PageHeader
        title="Create Purchase Order"
        description="Build a new purchase order with line items"
      />
      <POCreateForm facilityId={facility.id} vendors={vendors} />
    </div>
  )
}
