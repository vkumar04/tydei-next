"use client"

import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { queryKeys } from "@/lib/query-keys"
import { getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import { createChangeProposal } from "@/lib/actions/change-proposals"
import { VendorContractOverview } from "@/components/vendor/contracts/vendor-contract-overview"
import { ChangeProposalForm } from "@/components/vendor/contracts/change-proposal-form"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowLeft } from "lucide-react"
import { toast } from "sonner"
import Link from "next/link"
import type { CreateChangeProposalInput } from "@/lib/validators/change-proposals"

interface VendorContractEditClientProps {
  contractId: string
}

export function VendorContractEditClient({ contractId }: VendorContractEditClientProps) {
  const router = useRouter()

  const { data: contract, isLoading } = useQuery({
    queryKey: queryKeys.vendorContracts.detail(contractId),
    queryFn: () => getVendorContractDetail(contractId),
  })

  const handleSubmit = async (proposal: CreateChangeProposalInput) => {
    try {
      await createChangeProposal(proposal)
      toast.success("Change proposal submitted successfully")
      router.push(`/vendor/contracts/${contractId}`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to submit proposal")
    }
  }

  if (isLoading || !contract) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Edit Contract: ${contract.name}`}
        description="Propose changes to this contract"
        action={
          <Button variant="outline" size="sm" asChild>
            <Link href={`/vendor/contracts/${contractId}`}>
              <ArrowLeft className="size-4" /> Back
            </Link>
          </Button>
        }
      />

      <VendorContractOverview contract={contract} />

      <ChangeProposalForm
        contract={{
          id: contract.id,
          name: contract.name,
          vendorId: contract.vendor?.id ?? "",
          vendorName: contract.vendor?.name ?? "",
          facilityId: contract.facility?.id,
          facilityName: contract.facility?.name,
        }}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
