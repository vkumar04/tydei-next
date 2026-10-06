import { requireFacility } from "@/lib/actions/auth"
import { COGDataClient } from "@/components/facility/cog/cog-data-client"

export const instant = false

export default async function COGDataPage() {
  const { facility } = await requireFacility()

  return <COGDataClient facilityId={facility.id} />
}
