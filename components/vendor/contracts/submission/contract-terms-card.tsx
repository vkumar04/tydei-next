"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import type { TermFormValues } from "@/lib/validators/contract-terms"

export interface ContractTermsCardProps {
  contractTerms: TermFormValues[]
  onContractTermsChange: (terms: TermFormValues[]) => void
}

export function ContractTermsCard({
  contractTerms,
  onContractTermsChange,
}: ContractTermsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Terms</CardTitle>
        <CardDescription>
          Define rebate tiers, pricing terms, market share commitments,
          and other contract conditions
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ContractTermsEntry
          terms={contractTerms}
          onChange={onContractTermsChange}
        />
      </CardContent>
    </Card>
  )
}
