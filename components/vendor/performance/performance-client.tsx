"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useVendorContracts } from "@/hooks/use-vendor-contracts"
import { getVendorPerformance } from "@/lib/actions/vendor-analytics"
import { queryKeys } from "@/lib/query-keys"
import { PerformanceHero } from "./performance-hero"
import { PerformanceControlBar } from "./performance-control-bar"
import { PerformanceOverviewTab } from "./performance-overview-tab"
import { VendorCustomerConcentrationCard } from "./vendor-customer-concentration-card"
import { VendorTieInMembershipsCard } from "./vendor-tie-in-memberships-card"
import { PerformanceContractsTab } from "./performance-contracts-tab"
import { PerformanceRebatesTab } from "./performance-rebates-tab"
import { PerformanceCategoriesTab } from "./performance-categories-tab"
import {
  MOCK_CATEGORY_BREAKDOWN,
  MOCK_CONTRACT_PERFORMANCE,
  MOCK_DEFAULT_REBATE_TIERS,
  MOCK_MONTHLY_TREND,
} from "./performance-mocks"
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

  // Live data for radar + summary cards (gracefully fall back to mock values)
  const { data: perfData } = useQuery({
    queryKey: queryKeys.vendorAnalytics.performance(vendorId),
    queryFn: () => getVendorPerformance(vendorId),
  })
  const { data: contractsData } = useVendorContracts(vendorId, { status: "active" })

  // Build contract perf rows: real contracts first, fall back to mocks when empty
  const contractPerformance: ContractPerf[] = useMemo(() => {
    const contracts = contractsData?.contracts
    if (!Array.isArray(contracts) || contracts.length === 0) {
      return MOCK_CONTRACT_PERFORMANCE
    }
    const avgRate = perfData?.avgRebateRate ?? 4
    return contracts.map((c: Record<string, unknown>, i) => {
      const totalValue = Number(c.totalValue ?? c.annualValue ?? 0)
      const totalSpend = Number(c.totalSpend ?? 0)
      const compliance = totalValue > 0 ? Math.min((totalSpend / totalValue) * 100, 120) : 0
      const status: ContractPerf["status"] =
        compliance >= 100 ? "exceeding" : compliance >= 90 ? "on-track" : "at-risk"
      const rebatePaid = totalSpend * (avgRate / 100)
      return {
        id: (c.id as string) ?? `contract-${i}`,
        name: (c.name as string) ?? "Unnamed Contract",
        facility:
          ((c.facility as Record<string, unknown> | null)?.name as string) ??
          (c.facilityName as string) ??
          "Facility",
        targetSpend: totalValue || totalSpend * 1.1,
        actualSpend: totalSpend,
        targetVolume: 0,
        actualVolume: 0,
        rebateRate: avgRate,
        rebatePaid,
        compliance: Math.round(compliance * 10) / 10,
        status,
        rebateTiers: [
          { tier: "Tier 1", threshold: totalValue * 0.5, current: totalSpend, rebateRate: avgRate * 0.7, achieved: totalSpend >= totalValue * 0.5 },
          { tier: "Tier 2", threshold: totalValue * 0.8, current: totalSpend, rebateRate: avgRate, achieved: totalSpend >= totalValue * 0.8 },
          { tier: "Tier 3", threshold: totalValue, current: totalSpend, rebateRate: avgRate * 1.3, achieved: totalSpend >= totalValue },
        ],
      }
    })
  }, [contractsData, perfData])

  // Radar data — prefer live perfData signals when available
  const performanceRadar = useMemo<PerformanceRadarPoint[]>(() => {
    if (!perfData) {
      return [
        { metric: "Spend Compliance", value: 92, fullMark: 100 },
        { metric: "Volume Targets", value: 88, fullMark: 100 },
        { metric: "On-Time Delivery", value: 96, fullMark: 100 },
        { metric: "Quality Score", value: 94, fullMark: 100 },
        { metric: "Response Time", value: 89, fullMark: 100 },
      ]
    }
    return [
      { metric: "Spend Compliance", value: Math.round(perfData.compliance), fullMark: 100 },
      { metric: "Volume Targets", value: Math.round((perfData.compliance + perfData.delivery) / 2), fullMark: 100 },
      { metric: "On-Time Delivery", value: Math.round(perfData.delivery), fullMark: 100 },
      { metric: "Quality Score", value: Math.round(perfData.quality), fullMark: 100 },
      { metric: "Response Time", value: Math.round((perfData.delivery + perfData.quality) / 2), fullMark: 100 },
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

  const displayedRebateTiers = useMemo<ContractPerfTier[]>(() => {
    if (rebateContractFilter !== "all") {
      const contract = contractPerformance.find((c) => c.id === rebateContractFilter)
      return contract?.rebateTiers || MOCK_DEFAULT_REBATE_TIERS
    }
    if (rebateFacilityFilter !== "all") {
      const facilityContracts = contractPerformance.filter(
        (c) => c.facility === rebateFacilityFilter,
      )
      if (facilityContracts.length === 1) {
        return facilityContracts[0].rebateTiers
      }
      const totalSpend = facilityContracts.reduce((sum, c) => sum + c.actualSpend, 0)
      return [
        { tier: "Tier 1", threshold: 500000, current: totalSpend, rebateRate: 3.0, achieved: totalSpend >= 500000 },
        { tier: "Tier 2", threshold: 1000000, current: totalSpend, rebateRate: 4.5, achieved: totalSpend >= 1000000 },
        { tier: "Tier 3", threshold: 1500000, current: totalSpend, rebateRate: 6.0, achieved: totalSpend >= 1500000 },
      ]
    }
    return MOCK_DEFAULT_REBATE_TIERS
  }, [contractPerformance, rebateContractFilter, rebateFacilityFilter])

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
  // server action accepts a range filter.
  void timeRange

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
            monthlyTrend={MOCK_MONTHLY_TREND}
            radar={performanceRadar}
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
          <PerformanceCategoriesTab categories={MOCK_CATEGORY_BREAKDOWN} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
