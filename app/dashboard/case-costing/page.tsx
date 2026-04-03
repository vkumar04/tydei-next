import { requireFacility } from "@/lib/actions/auth"
import { CaseCostingClient } from "@/components/facility/case-costing/case-costing-client"
import { CaseCostingExplainer } from "@/components/facility/case-costing/case-costing-explainer"

export default async function CaseCostingPage() {
  const { facility } = await requireFacility()

  return (
    <div className="space-y-6">
      <CaseCostingExplainer />
      <CaseCostingClient facilityId={facility.id} />
    </div>
  )
}
