import { VendorContractEditClient } from "@/components/vendor/contracts/vendor-contract-edit-client"
import { requireVendor } from "@/lib/actions/auth"

export default async function VendorContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireVendor()
  const { id } = await params
  return <VendorContractEditClient contractId={id} />
}
