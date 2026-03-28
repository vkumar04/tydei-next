import { requireFacility } from "@/lib/actions/auth"
import { ContractsListClient } from "@/components/contracts/contracts-list-client"

export default async function ContractsPage() {
  const { facility } = await requireFacility()

  return <ContractsListClient facilityId={facility.id} />
}
