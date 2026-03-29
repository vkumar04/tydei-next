import { requireFacility } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { POList } from "@/components/facility/purchase-orders/po-list"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { Plus } from "lucide-react"

export default async function PurchaseOrdersPage() {
  const { facility } = await requireFacility()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Purchase Orders"
        description="Create and manage purchase orders"
        action={
          <Button asChild>
            <Link href="/dashboard/purchase-orders/new">
              <Plus className="size-4" /> New PO
            </Link>
          </Button>
        }
      />
      <POList facilityId={facility.id} />
    </div>
  )
}
