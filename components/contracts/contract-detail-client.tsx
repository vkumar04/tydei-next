"use client"

import { useRouter } from "next/navigation"
import { Pencil, Trash2, Sparkles } from "lucide-react"
import { useContract, useDeleteContract } from "@/hooks/use-contracts"
import { PageHeader } from "@/components/shared/page-header"
import { ContractDetailOverview } from "@/components/contracts/contract-detail-overview"
import { ContractTermsDisplay } from "@/components/contracts/contract-terms-display"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { ContractTransactions } from "@/components/contracts/contract-transactions"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { useState } from "react"

interface ContractDetailClientProps {
  contractId: string
}

export function ContractDetailClient({
  contractId,
}: ContractDetailClientProps) {
  const router = useRouter()
  const { data: contract, isLoading } = useContract(contractId)
  const deleteMutation = useDeleteContract()
  const [showDelete, setShowDelete] = useState(false)

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-[300px] w-full" />
        <Skeleton className="h-[200px] w-full" />
      </div>
    )
  }

  if (!contract) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title={contract.name}
        description={contract.contractNumber ?? undefined}
        action={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/dashboard/contracts/${contractId}/score`)
              }
            >
              <Sparkles className="size-4" /> AI Score
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                router.push(`/dashboard/contracts/${contractId}/edit`)
              }
            >
              <Pencil className="size-4" /> Edit
            </Button>
            <Button
              variant="destructive"
              onClick={() => setShowDelete(true)}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="space-y-6">
          <ContractTermsDisplay terms={contract.terms} />
          <ContractDocumentsList documents={contract.documents} />
          <ContractTransactions contractId={contractId} />
        </div>
        <div>
          <ContractDetailOverview contract={contract} />
        </div>
      </div>

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Delete Contract"
        description={`Are you sure you want to delete "${contract.name}"? This action cannot be undone.`}
        onConfirm={async () => {
          await deleteMutation.mutateAsync(contractId)
          router.push("/dashboard/contracts")
        }}
        isLoading={deleteMutation.isPending}
        variant="destructive"
      />
    </div>
  )
}
