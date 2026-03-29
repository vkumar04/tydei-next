"use client"

import { PageHeader } from "@/components/shared/page-header"
import { AIScorePage } from "@/components/contracts/ai-score-page"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"
import Link from "next/link"

interface ContractScoreClientProps {
  contractId: string
  contract: {
    name: string
    contractType: string
    totalValue: unknown
    annualValue: unknown
    vendor: { name: string }
    terms: Array<{ tiers: Array<unknown> }>
    [key: string]: unknown
  }
}

export function ContractScoreClient({
  contractId,
  contract,
}: ContractScoreClientProps) {
  const contractData = {
    name: contract.name,
    type: contract.contractType,
    totalValue: Number(contract.totalValue ?? 0),
    annualValue: Number(contract.annualValue ?? 0),
    vendor: contract.vendor.name,
    termsCount: contract.terms.length,
    tiersCount: contract.terms.reduce(
      (sum, t) => sum + t.tiers.length,
      0
    ),
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={`AI Score — ${contract.name}`}
        description="AI-powered deal analysis and negotiation advice"
        action={
          <Button variant="outline" asChild>
            <Link href={`/dashboard/contracts/${contractId}`}>
              <ArrowLeft className="size-4" /> Back
            </Link>
          </Button>
        }
      />

      <AIScorePage
        contractId={contractId}
        contractData={contractData}
        cogData={{}}
      />
    </div>
  )
}
