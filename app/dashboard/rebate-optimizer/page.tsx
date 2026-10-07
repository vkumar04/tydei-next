import { requireFacility } from "@/lib/actions/auth"
import { RebateOptimizerClient } from "@/components/facility/rebate-optimizer/optimizer-client"

export default async function RebateOptimizerPage() {
  const { facility } = await requireFacility()

  return <RebateOptimizerClient facilityId={facility.id} />
}
