import { requireFacility } from "@/lib/actions/auth"
import { CaseCostingReportsClient } from "./reports-client"

export default async function CaseCostingReportsPage() {
  const { facility } = await requireFacility()

  return <CaseCostingReportsClient facilityId={facility.id} />
}
