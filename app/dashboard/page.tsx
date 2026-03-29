import { requireFacility } from "@/lib/actions/auth"
import { DashboardClient } from "@/components/facility/dashboard/dashboard-client"

export default async function FacilityDashboard() {
  const { facility } = await requireFacility()

  return <DashboardClient facilityId={facility.id} />
}
