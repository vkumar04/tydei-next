import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { getFeatureFlags } from "@/lib/actions/settings"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { AIAgentClient } from "@/components/facility/ai-agent/ai-agent-client"

export default async function FacilityAIAgentPage() {
  const { facility } = await requireFacility()
  const flags = await getFeatureFlags(facility.id)

  // Pre-fetch a trimmed contracts list so the Documents + Reports tabs
  // can render their selectors without a client-side roundtrip. TanStack
  // Query still handles the document list + search + report mutation.
  const contracts = await prisma.contract.findMany({
    where: contractsOwnedByFacility(facility.id),
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 500,
  })

  return (
    <AIAgentClient
      facilityId={facility.id}
      enabled={flags.aiAgentEnabled}
      contracts={contracts}
    />
  )
}
