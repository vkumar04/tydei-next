import { requireFacility } from "@/lib/actions/auth"
import { ProspectiveClient } from "@/components/facility/analysis/prospective-client"

export default async function ProspectivePage() {
  const { facility } = await requireFacility()

  return <ProspectiveClient facilityId={facility.id} />
}
