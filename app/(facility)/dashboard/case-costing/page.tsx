import { requireFacility } from "@/lib/actions/auth"
import { CaseCostingClient } from "@/components/facility/case-costing/case-costing-client"

export default async function CaseCostingPage() {
  const { facility } = await requireFacility()

  return <CaseCostingClient facilityId={facility.id} />
}
