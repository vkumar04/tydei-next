import { ContractDetailClient } from "@/components/contracts/contract-detail-client"

export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  return <ContractDetailClient contractId={id} />
}
