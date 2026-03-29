import { requireFacility } from "@/lib/actions/auth"
import { getFeatureFlags } from "@/lib/actions/settings"
import { AIAgentClient } from "@/components/facility/ai-agent-client"

export default async function FacilityAIAgentPage() {
  const { facility } = await requireFacility()
  const flags = await getFeatureFlags(facility.id)

  return (
    <AIAgentClient
      facilityId={facility.id}
      enabled={flags.aiAgentEnabled}
    />
  )
}
