import { requireFacility } from "@/lib/actions/auth"
import { SurgeonCompareClient } from "./compare-client"

export default async function SurgeonComparePage() {
  const { facility } = await requireFacility()

  return <SurgeonCompareClient facilityId={facility.id} />
}
