"use client"

import { useCallback } from "react"
import Link from "next/link"
import { Pencil } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { Button } from "@/components/ui/button"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { VendorContractOverview } from "@/components/vendor/contracts/vendor-contract-overview"
import { ContractAmortizationCard } from "@/components/contracts/contract-amortization-card"
import { TieInRebateSplit } from "@/components/contracts/tie-in-rebate-split"
import { ContractScoreCard } from "@/components/contracts/analytics/contract-score-card"
import { RebateForecastCard } from "@/components/contracts/analytics/rebate-forecast-card"
import { TieInComplianceCard } from "@/components/contracts/analytics/tie-in-compliance-card"
import { ServiceSlaCard } from "@/components/contracts/analytics/service-sla-card"
import { getVendorContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"
import { toast } from "sonner"
import type { getVendorContractDetail } from "@/lib/actions/vendor-contracts"

type ContractDetail = Awaited<ReturnType<typeof getVendorContractDetail>>

interface VendorContractDetailClientProps {
  contract: ContractDetail
}

/**
 * Vendor-side contract detail with the v0-port analytics surfaces
 * mirrored from the facility view. The underlying server actions
 * (`getContractCompositeScore`, `getRenewalRisk`, `getRebateForecast`,
 * `getTieInCompliance`, `evaluateServiceSla`) are scope-aware via
 * `requireContractScope` — they verify the vendor owns this contract
 * before reading the COG aggregates pinned to the contract's primary
 * facility.
 *
 * Charles audit round-2 vendor BLOCKER 2 still applies: edit goes
 * through ChangeProposal at /vendor/contracts/[id]/edit.
 */
export function VendorContractDetailClient({
  contract,
}: VendorContractDetailClientProps) {
  const handleDocumentUpload = useCallback(() => {
    toast.info("Document upload coming soon")
  }, [])

  const isCapitalLike =
    contract.contractType === "tie_in" || contract.contractType === "capital"

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

      <Tabs defaultValue="overview" className="w-full">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <VendorContractOverview contract={contract} />
          {isCapitalLike && (
            <>
              <TieInRebateSplit
                contractId={contract.id}
                fetcher={getVendorContractCapitalSchedule}
                scope="vendor"
              />
              <ContractAmortizationCard
                contractId={contract.id}
                fetcher={getVendorContractCapitalSchedule}
                scope="vendor"
              />
            </>
          )}
        </TabsContent>

        <TabsContent value="performance" className="mt-6 space-y-6">
          {/* v0-port: vendors get the same composite score / renewal
              risk / rebate forecast the facility sees, scoped via
              requireContractScope. */}
          <ContractScoreCard contractId={contract.id} />
          {contract.contractType === "tie_in" ? (
            <TieInComplianceCard contractId={contract.id} />
          ) : null}
          {contract.contractType === "service" ? (
            <ServiceSlaCard contractId={contract.id} />
          ) : null}
          <RebateForecastCard contractId={contract.id} />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <ContractDocumentsList
            documents={contract.documents}
            contractId={contract.id}
            onUpload={handleDocumentUpload}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
