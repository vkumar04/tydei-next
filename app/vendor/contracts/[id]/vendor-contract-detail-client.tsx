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
// Performance-tab analytics cards are lazy-loaded (recharts is the
// heaviest single dep on this page). Same pattern as the facility
// detail client.
import dynamic from "next/dynamic"
const ContractScoreCard = dynamic(
  () =>
    import("@/components/contracts/analytics/contract-score-card").then(
      (m) => m.ContractScoreCard,
    ),
  { ssr: false },
)
const RebateForecastCard = dynamic(
  () =>
    import("@/components/contracts/analytics/rebate-forecast-card").then(
      (m) => m.RebateForecastCard,
    ),
  { ssr: false },
)
const TieInComplianceCard = dynamic(
  () =>
    import("@/components/contracts/analytics/tie-in-compliance-card").then(
      (m) => m.TieInComplianceCard,
    ),
  { ssr: false },
)
const ServiceSlaCard = dynamic(
  () =>
    import("@/components/contracts/analytics/service-sla-card").then(
      (m) => m.ServiceSlaCard,
    ),
  { ssr: false },
)
import { getVendorContractCapitalSchedule } from "@/lib/actions/contracts/tie-in"
import { toast } from "sonner"
import type { getVendorContractDetail } from "@/lib/actions/vendor-contracts"

type ContractDetail = Awaited<ReturnType<typeof getVendorContractDetail>>

interface VendorContractDetailClientProps {
  contract: ContractDetail
  initialPerformanceBundle?: Awaited<
    ReturnType<
      typeof import("@/lib/actions/analytics/contract-performance-bundle").getContractPerformanceBundle
    >
  >
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
  initialPerformanceBundle,
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
          <ContractScoreCard
            contractId={contract.id}
            initialScore={initialPerformanceBundle?.score}
          />
          {contract.contractType === "tie_in" ? (
            <TieInComplianceCard
              contractId={contract.id}
              initialData={initialPerformanceBundle?.tieIn ?? undefined}
            />
          ) : null}
          {contract.contractType === "service" ? (
            <ServiceSlaCard contractId={contract.id} />
          ) : null}
          <RebateForecastCard
            contractId={contract.id}
            initialData={initialPerformanceBundle?.forecast}
          />
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
