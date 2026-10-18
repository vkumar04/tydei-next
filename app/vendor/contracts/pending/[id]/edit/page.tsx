import { PendingContractEditClient } from "@/components/vendor/contracts/pending-contract-edit-client"
import { requireVendor } from "@/lib/actions/auth"
import { redirectUnlessCanMutate } from "@/lib/auth/page-gates"

export default async function PendingContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireVendor()
  const { id } = await params
  await redirectUnlessCanMutate("/vendor/contracts")
  return <PendingContractEditClient pendingContractId={id} />
}
