"use client"

import { useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import { GitCompareArrows, Upload } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { VendorContractOverview } from "@/components/vendor/contracts/vendor-contract-overview"
import { AmendmentExtractor } from "@/components/contracts/amendment-extractor"
import { toast } from "sonner"
import type { getVendorContractDetail } from "@/lib/actions/vendor-contracts"

type ContractDetail = Awaited<ReturnType<typeof getVendorContractDetail>>

interface VendorContractDetailClientProps {
  contract: ContractDetail
}

export function VendorContractDetailClient({ contract }: VendorContractDetailClientProps) {
  const router = useRouter()
  const [amendmentOpen, setAmendmentOpen] = useState(false)

  const handleAmendmentApplied = useCallback(() => {
    router.refresh()
  }, [router])

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
            <Button variant="outline" size="sm" onClick={() => setAmendmentOpen(true)}>
              <GitCompareArrows className="mr-2 h-4 w-4" />
              Extract Amendment
            </Button>
          </div>
        }
      />
      <VendorContractOverview contract={contract} />
      <ContractDocumentsList documents={contract.documents} onUpload={handleDocumentUpload} />

      <AmendmentExtractor
        contractId={contract.id}
        open={amendmentOpen}
        onOpenChange={setAmendmentOpen}
        onApplied={handleAmendmentApplied}
      />
    </div>
  )
}
