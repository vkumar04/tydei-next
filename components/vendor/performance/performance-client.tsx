"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  getVendorPerformance,
  getVendorPerformanceCategoryBreakdown,
  getVendorPerformanceContracts,
  getVendorPerformanceMonthlyTrend,
  getVendorPerformanceTiers,
} from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"
import { PerformanceHero } from "./performance-hero"
import { PerformanceControlBar } from "./performance-control-bar"
import { PerformanceOverviewTab } from "./performance-overview-tab"
import { VendorCustomerConcentrationCard } from "./vendor-customer-concentration-card"
import { VendorTieInMembershipsCard } from "./vendor-tie-in-memberships-card"
import { PerformanceContractsTab } from "./performance-contracts-tab"
import { PerformanceRebatesTab } from "./performance-rebates-tab"
import { PerformanceCategoriesTab } from "./performance-categories-tab"
import type {
  ContractPerf,
  ContractPerfTier,
  PerformanceRadarPoint,
} from "./performance-types"

interface PerformanceClientProps {
  vendorId: string
}

export function PerformanceClient({ vendorId }: PerformanceClientProps) {
  const [timeRange, setTimeRange] = useState("ytd")
  const [rebateContractFilter, setRebateContractFilter] = useState("all")
  const [rebateFacilityFilter, setRebateFacilityFilter] = useState("all")

  // ─── Live data ──────────────────────────────────────────────────
  // Charles vendor /performance audit (V2): every metric on this page
  // now comes from a real action against cOGRecord / Rebate /
  // ContractTier. The previous version mixed in MOCK_* constants
  // (radar 92/88/96/94/89, MOCK_CATEGORY_BREAKDOWN, etc.) which made
  // it impossible to tell which numbers were real.
  const { data: perfData, isLoading: perfLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performance(vendorId),
    queryFn: () => getVendorPerformance(vendorId),
  })
  const { data: contractRows, isLoading: contractRowsLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performanceContracts(vendorId),
    queryFn: () => getVendorPerformanceContracts(vendorId),
  })
  const { data: monthlyTrend, isLoading: trendLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performanceMonthlyTrend(vendorId),
    queryFn: () => getVendorPerformanceMonthlyTrend(vendorId),
  })
  const { data: categories, isLoading: categoriesLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performanceCategories(vendorId),
    queryFn: () => getVendorPerformanceCategoryBreakdown(vendorId),
  })
  const { data: tierRows, isLoading: tiersLoading } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performanceTiers(vendorId),
    queryFn: () => getVendorPerformanceTiers(vendorId),
  })

  // ─── Per-contract perf rows (server-derived) ────────────────────
  const contractPerformance: ContractPerf[] = useMemo(() => {
    if (!Array.isArray(contractRows)) return []
    return contractRows.map((c) => {
      const tiersForContract = (tierRows ?? []).filter(
        (t) => t.contractId === c.id,
      )
      return {
        id: c.id,
        name: c.name,
        facility: c.facility,
        targetSpend: c.targetSpend,
        actualSpend: c.actualSpend,
        targetVolume: 0,
        actualVolume: 0,
        rebateRate: c.rebateRate,
        rebatePaid: c.rebatePaid,
        compliance: c.compliance,
        status: c.status,
        rebateTiers: tiersForContract.map((t) => ({
          tier: t.tier,
          threshold: t.threshold,
          current: t.current,
          rebateRate: t.rebateRate,
          achieved: t.achieved,
        })),
      }
    })
  }, [contractRows, tierRows])

  // ─── Radar: real signals only, null axes render as "—" ──────────
  const performanceRadar = useMemo<PerformanceRadarPoint[]>(() => {
    if (!perfData) return []
    return [
      {
        metric: "Spend Compliance",
        value: perfData.compliance ?? null,
        fullMark: 100,
      },
      {
        metric: "On-Time Delivery",
        value: perfData.delivery ?? null,
        fullMark: 100,
      },
      {
        metric: "Quality Score",
        value: perfData.quality ?? null,
        fullMark: 100,
      },
      {
        metric: "Pricing",
        value: perfData.pricing ?? null,
        fullMark: 100,
      },
      {
        metric: "Response Time",
        value: perfData.responsiveness ?? null,
        fullMark: 100,
      },
    ]
  }, [perfData])

  const uniqueFacilities = useMemo(
    () => Array.from(new Set(contractPerformance.map((c) => c.facility))),
    [contractPerformance],
  )

  const filteredContracts = useMemo(
    () =>
      contractPerformance.filter((c) => {
        if (rebateContractFilter !== "all" && c.id !== rebateContractFilter) return false
        if (rebateFacilityFilter !== "all" && c.facility !== rebateFacilityFilter) return false
        return true
      }),
    [contractPerformance, rebateContractFilter, rebateFacilityFilter],
  )

  // ─── Tier ladder for the Rebate Progress tab ────────────────────
  // Real ContractTier rows from `getVendorPerformanceTiers`. When a
  // single contract or single-contract facility is selected, show its
  // tiers verbatim. Otherwise aggregate by tier-name across the
  // vendor's contracts (sum threshold + sum current). When the vendor
  // has no tiers configured we render an empty-state message in the
  // Rebate Progress tab rather than fabricating numbers.
  const displayedRebateTiers = useMemo<ContractPerfTier[]>(() => {
    if (!Array.isArray(tierRows) || tierRows.length === 0) return []
    if (rebateContractFilter !== "all") {
      const contract = contractPerformance.find((c) => c.id === rebateContractFilter)
      return contract?.rebateTiers ?? []
    }
    if (rebateFacilityFilter !== "all") {
      const facilityContracts = contractPerformance.filter(
        (c) => c.facility === rebateFacilityFilter,
      )
      if (facilityContracts.length === 1) {
        return facilityContracts[0].rebateTiers
      }
      return aggregateTiersByName(
        facilityContracts.flatMap((c) => c.rebateTiers),
      )
    }
    return aggregateTiersByName(
      contractPerformance.flatMap((c) => c.rebateTiers),
    )
  }, [tierRows, contractPerformance, rebateContractFilter, rebateFacilityFilter])

  const totalTargetSpend =
    contractPerformance.reduce((sum, c) => sum + c.targetSpend, 0) || 1
  const totalActualSpend = contractPerformance.reduce((sum, c) => sum + c.actualSpend, 0)
  const totalRebatesPaid = contractPerformance.reduce((sum, c) => sum + c.rebatePaid, 0)
  const avgCompliance =
    contractPerformance.length > 0
      ? contractPerformance.reduce((sum, c) => sum + c.compliance, 0) / contractPerformance.length
      : 0
  const contractsAtRisk = contractPerformance.filter((c) => c.status === "at-risk").length
  const contractsExceeding = contractPerformance.filter((c) => c.status === "exceeding").length

  const topContract = useMemo(() => {
    if (contractPerformance.length === 0) return null
    return [...contractPerformance].sort((a, b) => b.rebatePaid - a.rebatePaid)[0]
  }, [contractPerformance])

  const handleClearFilters = () => {
    setRebateContractFilter("all")
    setRebateFacilityFilter("all")
  }

  // `timeRange` is retained in state so the control bar can round-trip the
  // selection; the underlying analytics queries will consume it once the
  // server actions accept a range filter.
  void timeRange

  const isLoading =
    perfLoading || contractRowsLoading || trendLoading || categoriesLoading || tiersLoading

  return (
    <div className="flex flex-col gap-6">
      <PerformanceHero
        totalActualSpend={totalActualSpend}
        totalTargetSpend={totalTargetSpend}
        totalRebatesPaid={totalRebatesPaid}
        avgCompliance={avgCompliance}
        contractsExceeding={contractsExceeding}
        contractsAtRisk={contractsAtRisk}
        contractCount={contractPerformance.length}
        facilityCount={uniqueFacilities.length}
        topContractName={topContract?.name ?? null}
        topContractFacility={topContract?.facility ?? null}
        topContractRebate={topContract?.rebatePaid ?? 0}
      />

      <PerformanceControlBar
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        contractCount={contractPerformance.length}
        facilityCount={uniqueFacilities.length}
      />

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="contracts">By Contract</TabsTrigger>
          <TabsTrigger value="rebates">Rebate Progress</TabsTrigger>
          <TabsTrigger value="categories">By Category</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <PerformanceOverviewTab
            monthlyTrend={monthlyTrend ?? []}
            radar={performanceRadar}
            isLoading={isLoading}
          />
          {/* v0-port: vendor-side mirror of the facility's spend HHI —
              answers "how concentrated is my revenue across customers?". */}
          <VendorCustomerConcentrationCard />
          {/* v0-port: cross-vendor tie-in bundles this vendor is a member
              of (returns null when there are none). */}
          <VendorTieInMembershipsCard />
        </TabsContent>

        <TabsContent value="contracts" className="space-y-4">
          <PerformanceContractsTab contracts={contractPerformance} />
        </TabsContent>

        <TabsContent value="rebates" className="space-y-4">
          <PerformanceRebatesTab
            allContracts={contractPerformance}
            filteredContracts={filteredContracts}
            displayedRebateTiers={displayedRebateTiers}
            uniqueFacilities={uniqueFacilities}
            rebateContractFilter={rebateContractFilter}
            rebateFacilityFilter={rebateFacilityFilter}
            onContractFilterChange={setRebateContractFilter}
            onFacilityFilterChange={setRebateFacilityFilter}
            onClearFilters={handleClearFilters}
            totalRebatesPaid={totalRebatesPaid}
            totalActualSpend={totalActualSpend}
          />
        </TabsContent>

        <TabsContent value="categories" className="space-y-4">
          <PerformanceCategoriesTab
            categories={categories ?? []}
            isLoading={categoriesLoading}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

/**
 * Aggregate ContractTier rows by tierName so the "all contracts" /
 * multi-contract-facility view of the rebate ladder shows real summed
 * thresholds and current spend, not a hand-picked $1M / $2M / $3.5M
 * MOCK_DEFAULT_REBATE_TIERS placeholder. rebateRate is computed as a
 * weighted average using each tier's threshold as the weight.
 */
function aggregateTiersByName(tiers: ContractPerfTier[]): ContractPerfTier[] {
  if (tiers.length === 0) return []
  const grouped = new Map<
    string,
    { threshold: number; current: number; rateNum: number; rateDen: number }
  >()
  for (const t of tiers) {
    const entry = grouped.get(t.tier) ?? {
      threshold: 0,
      current: 0,
      rateNum: 0,
      rateDen: 0,
    }
    entry.threshold += t.threshold
    entry.current += t.current
    entry.rateNum += t.rebateRate * (t.threshold || 1)
    entry.rateDen += t.threshold || 1
    grouped.set(t.tier, entry)
  }
  return Array.from(grouped.entries()).map(([tier, v]) => ({
    tier,
    threshold: v.threshold,
    current: v.current,
    rebateRate: v.rateDen > 0 ? Math.round((v.rateNum / v.rateDen) * 100) / 100 : 0,
    achieved: v.threshold > 0 && v.current >= v.threshold,
  }))
}
