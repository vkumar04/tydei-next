import { requireFacility } from "@/lib/actions/auth"
import { AnalysisClient } from "@/components/facility/analysis/analysis-client"

export default async function AnalysisPage() {
  const { facility } = await requireFacility()

  return <AnalysisClient facilityId={facility.id} />
}
