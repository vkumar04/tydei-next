import { requireFacility } from "@/lib/actions/auth"
import { getPurchaseOrder } from "@/lib/actions/purchase-orders"
import { PageHeader } from "@/components/shared/page-header"
import { PODetailView } from "@/components/facility/purchase-orders/po-detail"

interface Props {
  params: Promise<{ id: string }>
}

export default async function PurchaseOrderDetailPage({ params }: Props) {
  await requireFacility()
  const { id } = await params
  const order = await getPurchaseOrder(id)

  return (
    <div className="space-y-6">
      <PageHeader title={order.poNumber} description="Purchase order details" />
      <PODetailView order={order} />
    </div>
  )
}
