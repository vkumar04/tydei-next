import { PendingContractEditClient } from "@/components/vendor/contracts/pending-contract-edit-client"
import { requireVendor } from "@/lib/actions/auth"

export default async function PendingContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireVendor()
  const { id } = await params
  return <PendingContractEditClient pendingContractId={id} />
}
