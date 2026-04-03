import { ContractTermsPageClient } from "@/components/facility/contracts/contract-terms-page-client"

export default async function ContractTermsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  return <ContractTermsPageClient contractId={id} />
}
