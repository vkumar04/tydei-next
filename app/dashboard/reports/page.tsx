import { requireFacility } from "@/lib/actions/auth"
import { ReportsClient } from "@/components/facility/reports/reports-client"

export default async function ReportsPage() {
  const { facility } = await requireFacility()

  return <ReportsClient facilityId={facility.id} />
}
