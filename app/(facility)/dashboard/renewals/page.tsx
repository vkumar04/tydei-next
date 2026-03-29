import { requireFacility } from "@/lib/actions/auth"
import { RenewalsClient } from "@/components/facility/renewals/renewals-client"

export default async function RenewalsPage() {
  const { facility } = await requireFacility()

  return <RenewalsClient facilityId={facility.id} />
}
