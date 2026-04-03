import { PendingContractEditClient } from "@/components/vendor/contracts/pending-contract-edit-client"

export default async function PendingContractEditPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <PendingContractEditClient pendingContractId={id} />
}
