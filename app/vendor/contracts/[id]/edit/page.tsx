import { VendorContractEditClient } from "@/components/vendor/contracts/vendor-contract-edit-client"
import { requireVendor } from "@/lib/actions/auth"
import { redirectUnlessCanMutate } from "@/lib/auth/page-gates"

export default async function VendorContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireVendor()
  const { id } = await params
  await redirectUnlessCanMutate(`/vendor/contracts/${id}`)
  return <VendorContractEditClient contractId={id} />
}
