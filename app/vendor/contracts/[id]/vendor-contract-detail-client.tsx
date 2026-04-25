"use client"

import { useCallback } from "react"
import Link from "next/link"
import { Pencil } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { VendorContractOverview } from "@/components/vendor/contracts/vendor-contract-overview"
import { toast } from "sonner"
import type { getVendorContractDetail } from "@/lib/actions/vendor-contracts"

type ContractDetail = Awaited<ReturnType<typeof getVendorContractDetail>>

interface VendorContractDetailClientProps {
  contract: ContractDetail
}

/**
 * Charles audit round-2 vendor BLOCKER 2: removed the
 * AmendmentExtractor button. Vendors can't apply contract amendments
 * directly — that goes through the ChangeProposal flow at
 * /vendor/contracts/[id]/edit, which the facility then approves.
 * The previous AmendmentExtractor would 401 because it called
 * `updateContract` (facility-only). Replaced the CTA with a link
 * to the proposal flow.
 */
export function VendorContractDetailClient({ contract }: VendorContractDetailClientProps) {
  const handleDocumentUpload = useCallback(() => {
    toast.info("Document upload coming soon")
  }, [])

  return (
    <div className="space-y-6">
      <PageHeader
        title={contract.name}
        description="Contract details"
        action={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href={`/vendor/contracts/${contract.id}/edit`}>
                <Pencil className="mr-2 h-4 w-4" />
                Propose Changes
              </Link>
            </Button>
          </div>
        }
      />
      <VendorContractOverview contract={contract} />
      <ContractDocumentsList documents={contract.documents} contractId={contract.id} onUpload={handleDocumentUpload} />
    </div>
  )
}
