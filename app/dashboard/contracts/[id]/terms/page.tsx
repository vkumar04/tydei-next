import { ContractTermsPageClient } from "@/components/facility/contracts/contract-terms-page-client"
import { requireFacility } from "@/lib/actions/auth"

export default async function ContractTermsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireFacility()
  const { id } = await params
  return <ContractTermsPageClient contractId={id} />
}
