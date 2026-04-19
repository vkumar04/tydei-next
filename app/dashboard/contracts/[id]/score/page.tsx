import { requireFacility } from "@/lib/actions/auth"
import { getContract } from "@/lib/actions/contracts"
import { computeContractScoreLive } from "@/lib/actions/contracts/scoring"
import { ContractScoreClient } from "@/components/facility/contracts/contract-score-client"
import type { ContractScoreResult } from "@/lib/contracts/scoring"
import {
  getScoreBenchmark,
  type ScoreBenchmark,
} from "@/lib/contracts/score-benchmarks"

export default async function ContractScorePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireFacility()
  const contract = await getContract(id)

  // Read-only: compute the rule-based components fresh on every page
  // load WITHOUT persisting to Contract.score or writing an audit row.
  // Persistence happens via mutations (createContract / updateContract /
  // explicit "recompute scores" actions), not on every page view.
  let ruleBasedComponents: ContractScoreResult["components"] | undefined
  try {
    const result = await computeContractScoreLive(id)
    ruleBasedComponents = result.components
  } catch {
    ruleBasedComponents = undefined
  }

  const benchmark: ScoreBenchmark | undefined = contract?.contractType
    ? getScoreBenchmark(contract.contractType)
    : undefined

  return (
    <ContractScoreClient
      contractId={id}
      contract={contract}
      ruleBasedComponents={ruleBasedComponents}
      benchmark={benchmark}
    />
  )
}
