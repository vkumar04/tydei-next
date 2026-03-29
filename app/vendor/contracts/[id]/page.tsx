import { requireVendor } from "@/lib/actions/auth"
import { getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import { PageHeader } from "@/components/shared/page-header"
import { ContractTermsDisplay } from "@/components/contracts/contract-terms-display"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { VendorContractOverview } from "@/components/vendor/contracts/vendor-contract-overview"

interface Props {
  params: Promise<{ id: string }>
}

export default async function VendorContractDetailPage({ params }: Props) {
  const { vendor } = await requireVendor()
  const { id } = await params
  const contract = await getVendorContractDetail(id, vendor.id)

  return (
    <div className="space-y-6">
      <PageHeader title={contract.name} description="Contract details" />
      <div className="grid gap-6 lg:grid-cols-2">
        <VendorContractOverview contract={contract} />
        <ContractTermsDisplay terms={contract.terms} />
      </div>
      <ContractDocumentsList documents={contract.documents} />
    </div>
  )
}
