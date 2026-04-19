import { requireFacility } from "@/lib/actions/auth"
import { getContract } from "@/lib/actions/contracts"
import { recomputeContractScore } from "@/lib/actions/contracts/scoring"
import { ContractScoreClient } from "@/components/facility/contracts/contract-score-client"
import type { ContractScoreResult } from "@/lib/contracts/scoring"

export default async function ContractScorePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireFacility()
  const contract = await getContract(id)

  // Recompute the rule-based score so the radar always reflects
  // current commitment / compliance / rebate / timeliness / variance
  // rollups. Failure must not break the AI-driven page.
  let ruleBasedComponents: ContractScoreResult["components"] | undefined
  try {
    const result = await recomputeContractScore(id)
    ruleBasedComponents = result.components
  } catch {
    ruleBasedComponents = undefined
  }

  return (
    <ContractScoreClient
      contractId={id}
      contract={contract}
      ruleBasedComponents={ruleBasedComponents}
    />
  )
}
