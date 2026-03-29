import { requireFacility } from "@/lib/actions/auth"
import { getContract } from "@/lib/actions/contracts"
import { ContractScoreClient } from "@/components/facility/contracts/contract-score-client"

export default async function ContractScorePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireFacility()
  const contract = await getContract(id)

  return <ContractScoreClient contractId={id} contract={contract} />
}
