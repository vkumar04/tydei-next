import { requireFacility } from "@/lib/actions/auth"
import { POList } from "@/components/facility/purchase-orders/po-list"

export default async function PurchaseOrdersPage() {
  const { facility } = await requireFacility()

  return <POList facilityId={facility.id} />
}
