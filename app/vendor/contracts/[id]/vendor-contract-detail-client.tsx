"use client"

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
import { ContractAccrualTimeline } from "@/components/contracts/contract-accrual-timeline"
import { getVendorAccrualTimeline } from "@/lib/actions/contracts/accrual"
import { useQuery } from "@tanstack/react-query"
import { getVendorContractPeriods } from "@/lib/actions/contract-periods"
import { getVendorContractPerformanceHistory } from "@/lib/actions/contracts/performance-history"
import { PerformanceSummary } from "@/components/contracts/tabs/_performance-summary"
import { VendorPricingTable } from "@/components/vendor/contracts/vendor-pricing-table"
import { hasSpendDollarTierLadder } from "@/lib/contracts/tier-metric"
// Performance-tab analytics cards are lazy-loaded (recharts is the
// heaviest single dep on this page). Same pattern as the facility
// detail client.
import dynamic from "next/dynamic"
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
const ContractPerformanceCharts = dynamic(
  () =>
    import("@/components/contracts/contract-performance-charts").then(
      (m) => m.ContractPerformanceCharts,
    ),
  { ssr: false },
)
import {
  getVendorContractCapitalSchedule,
  getVendorContractCapitalProjection,
} from "@/lib/actions/contracts/tie-in"
import { ContractCapitalProjectionCard } from "@/components/contracts/contract-capital-projection-card"
import { VendorCarveOutCard } from "@/components/vendor/contracts/vendor-carve-out-card"
import type { getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import { queryKeys } from "@/lib/query-keys"

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
  const isCapitalLike =
    contract.contractType === "tie_in" || contract.contractType === "capital"

  // 2026-06-09 facility→vendor UI parity: Spend by Period + Tier
  // Achievement, same data the facility Performance tab shows, scoped
  // through getVendorContractPeriods (vendor auth, same builder).
  const { data: periods } = useQuery({
    queryKey: queryKeys.contracts.vendorPeriods(contract.id),
    queryFn: () => getVendorContractPeriods(contract.id),
  })

  // Mirror the facility client's tier-term selection (Charles "carve out
  // has NOT tiers but it has tiers 4,3,7"): the Tier Achievement panel
  // reads tiers ONLY from a term with a real spend-dollar ladder —
  // hasSpendDollarTierLadder excludes market_share/compliance (percent
  // thresholds), volume (count), and carve_out/tie_in placeholder tiers.
  const tierTerm = contract.terms?.find((t) => hasSpendDollarTierLadder(t))
  const carveOutNotice =
    !tierTerm &&
    (contract.terms?.some((t) => t.termType === "carve_out") ?? false)

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
          {/* Charles 2026-04-26 #62: Accruals tab for vendor parity
              with the facility surface. Pulls the same monthly
              accrual timeline the facility sees, scoped through
              getVendorAccrualTimeline. */}
          <TabsTrigger value="accruals">Accruals</TabsTrigger>
          {/* Charles 2026-04-26 #65: dedicated Amortization tab for
              capital-like contracts so vendors get the same surface
              the facility side has. Previously the schedule was
              tucked at the bottom of Overview and easy to miss. */}
          {isCapitalLike && (
            <TabsTrigger value="amortization">Amortization</TabsTrigger>
          )}
          <TabsTrigger value="performance">Performance</TabsTrigger>
          {/* 2026-06-09 facility→vendor UI parity: vendors can now see
              the price list governing their own contract (read-only —
              pricing mutations stay facility-gated). */}
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-6 space-y-6">
          <VendorContractOverview contract={contract} />
          {isCapitalLike && (
            <TieInRebateSplit
              contractId={contract.id}
              fetcher={getVendorContractCapitalSchedule}
              scope="vendor"
            />
          )}
        </TabsContent>

        <TabsContent value="accruals" className="mt-6 space-y-6">
          <ContractAccrualTimeline
            contractId={contract.id}
            fetcher={getVendorAccrualTimeline}
          />
        </TabsContent>

        {isCapitalLike && (
          <TabsContent value="amortization" className="mt-6 space-y-6">
            <TieInRebateSplit
              contractId={contract.id}
              fetcher={getVendorContractCapitalSchedule}
              scope="vendor"
            />
            {/* 2026-06-09 facility→vendor port: Capital Payoff Projection
                (run-rate velocity + months-to-payoff) — same card the
                facility Amortization surface shows, vendor-scoped fetcher. */}
            <ContractCapitalProjectionCard
              contractId={contract.id}
              fetcher={getVendorContractCapitalProjection}
            />
            <ContractAmortizationCard
              contractId={contract.id}
              fetcher={getVendorContractCapitalSchedule}
              scope="vendor"
            />
          </TabsContent>
        )}

        <TabsContent value="performance" className="mt-6 space-y-6">
          {contract.contractType === "tie_in" ? (
            <TieInComplianceCard
              contractId={contract.id}
              initialData={initialPerformanceBundle?.tieIn ?? undefined}
            />
          ) : null}
          {contract.contractType === "service" ? (
            <ServiceSlaCard contractId={contract.id} />
          ) : null}
          {/* 2026-06-09 facility→vendor port: per-SKU carve-out rebate +
              effective rate — the vendor's flagship contract is a carve-out
              tie-in and had no carve-out surface. Self-hides when empty. */}
          <VendorCarveOutCard contractId={contract.id} />
          <RebateForecastCard
            contractId={contract.id}
            initialData={initialPerformanceBundle?.forecast}
          />
          {/* 2026-06-09 facility→vendor UI parity: Monthly Spend +
              Rebate by Quarter charts, vendor-scoped fetcher. */}
          <ContractPerformanceCharts
            contractId={contract.id}
            fetcher={getVendorContractPerformanceHistory}
          />
          <PerformanceSummary
            periods={periods ?? []}
            totalValue={Number(contract.totalValue ?? 0)}
            carveOutNotice={carveOutNotice}
            evaluationPeriod={
              (tierTerm?.evaluationPeriod ?? null) as
                | "monthly"
                | "quarterly"
                | "semi_annual"
                | "annual"
                | null
            }
            contractTiers={
              tierTerm?.tiers.map((t) => ({
                tierNumber: t.tierNumber,
                spendMin: Number(t.spendMin),
              })) ?? []
            }
          />
        </TabsContent>

        <TabsContent value="pricing" className="mt-6">
          <VendorPricingTable contractId={contract.id} />
        </TabsContent>

        <TabsContent value="documents" className="mt-6">
          <ContractDocumentsList
            documents={contract.documents}
            contractId={contract.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
