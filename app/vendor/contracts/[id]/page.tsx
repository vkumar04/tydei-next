import { requireVendor } from "@/lib/actions/auth"
import { getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import { VendorContractDetailClient } from "./vendor-contract-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

export default async function VendorContractDetailPage({ params }: Props) {
  const { vendor } = await requireVendor()
  const { id } = await params
  const contract = await getVendorContractDetail(id, vendor.id)

  return <VendorContractDetailClient contract={contract} />
}
