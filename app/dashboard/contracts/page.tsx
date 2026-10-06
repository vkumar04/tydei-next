import { requireFacility } from "@/lib/actions/auth"
import { ContractsListClient } from "@/components/contracts/contracts-list-client"

export const instant = false

export default async function ContractsPage() {
  const session = await requireFacility()

  return <ContractsListClient facilityId={session.facility.id} userId={session.user.id} />
}
