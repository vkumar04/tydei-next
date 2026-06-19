"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { queryKeys } from "@/lib/query-keys"
import { getVendorReportContracts } from "@/lib/actions/vendor-reports/contracts-list"
import { VendorReportsControlBar } from "./vendor-reports-control-bar"
import {
  VendorReportsTabRouter,
  computeAvailableVendorTabs,
} from "./vendor-reports-tab-router"
import { VendorReportsOverviewTab } from "./vendor-reports-overview-tab"
import { VendorReportsPerTypeTab } from "./vendor-reports-per-type-tab"
import { VendorReportsByRebateTypeTab } from "./vendor-reports-by-rebate-type-tab"
import { VendorReportsCalculationsTab } from "./vendor-reports-calculations-tab"
import {
  ReportPdfButton,
  tabToPdfReportType,
} from "@/components/shared/reports/report-pdf-button"
import type {
  ReportsDateRange,
  ReportTabKey,
  VendorReportsContract,
} from "./vendor-reports-types"

/**
 * Vendor Reports Hub orchestrator — vendor-scoped mirror of the facility
 * `ReportsClient`. Full parity: Overview / per-contract-type performance
 * details (Usage/Capital/Service/Tie-In/Grouped/Pricing) / By Rebate Type
 * / Calculations, all scoped to the calling vendor's contracts across
 * every facility they serve.
 *
 * Per-tab data fetching lives inside each tab component (each calls the
 * vendor action + `queryKeys.vendorReports.*` keys), so the hub stays
 * focused on composition.
 *
 *   1. ControlBar — Facility filter + Contract selector + date range.
 *   2. Tabs — Overview / per-type / By Rebate Type / Calculations.
 */
export interface VendorReportsHubClientProps {
  vendorId: string
  facilities: { id: string; name: string }[]
}

const TYPE_TO_TAB: Record<string, ReportTabKey> = {
  usage: "usage",
  capital: "capital",
  service: "service",
  tie_in: "tie_in",
  grouped: "grouped",
  pricing_only: "pricing",
}

function defaultRange(): ReportsDateRange {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - 3)
  return {
    from: from.toISOString().split("T")[0],
    to: to.toISOString().split("T")[0],
  }
}

export function VendorReportsHubClient({
  vendorId,
  facilities,
}: VendorReportsHubClientProps) {
  const [dateRange, setDateRange] = useState<ReportsDateRange>(defaultRange)
  const [selectedFacilityId, setSelectedFacilityId] = useState("all")
  const [selectedContractId, setSelectedContractId] = useState("all")
  const [activeTab, setActiveTab] = useState<ReportTabKey>("overview")

  const { data: contractsRaw } = useQuery({
    queryKey: queryKeys.vendorReports.contracts(vendorId),
    queryFn: () => getVendorReportContracts(),
  })

  const contracts = useMemo<VendorReportsContract[]>(() => {
    return (contractsRaw ?? []) as VendorReportsContract[]
  }, [contractsRaw])

  // The Calculations selector + the by-facility filter both operate on
  // the contracts visible for the currently selected facility.
  const facilityScopedContracts = useMemo<VendorReportsContract[]>(() => {
    if (selectedFacilityId === "all") return contracts
    return contracts.filter((c) => c.facilityId === selectedFacilityId)
  }, [contracts, selectedFacilityId])

  const selectedContract = useMemo<VendorReportsContract | null>(
    () =>
      selectedContractId === "all"
        ? null
        : (contracts.find((c) => c.id === selectedContractId) ?? null),
    [contracts, selectedContractId],
  )

  // Auto-route to a matching tab when a specific contract is picked,
  // and fall back to overview when the current tab isn't in the
  // available set.
  useEffect(() => {
    const available = new Set(computeAvailableVendorTabs(selectedContract))
    if (selectedContract) {
      const typeTab = TYPE_TO_TAB[selectedContract.contractType]
      if (typeTab && available.has(typeTab)) {
        setActiveTab(typeTab)
        return
      }
    }
    if (!available.has(activeTab)) {
      setActiveTab("overview")
    }
  }, [selectedContract, activeTab])

  function handleFacilityChange(facilityId: string) {
    setSelectedFacilityId(facilityId)
    // Reset contract selection when the facility changes.
    setSelectedContractId("all")
  }

  return (
    <div className="space-y-6">
      <VendorReportsControlBar
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        selectedFacilityId={selectedFacilityId}
        onFacilityChange={handleFacilityChange}
        selectedContractId={selectedContractId}
        onContractChange={setSelectedContractId}
        facilities={facilities}
        contracts={contracts}
      />

      <div id="vendor-reports-tabs">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as ReportTabKey)}
        >
          <div className="flex items-center justify-between gap-2">
            <VendorReportsTabRouter selectedContract={selectedContract} />
            <ReportPdfButton
              scope="vendor"
              reportType={tabToPdfReportType(activeTab)}
              dateRange={dateRange}
              contractId={selectedContractId}
            />
          </div>

          <TabsContent value="overview" className="mt-4">
            <VendorReportsOverviewTab
              vendorId={vendorId}
              dateRange={dateRange}
            />
          </TabsContent>

          {(
            ["usage", "capital", "service", "tie_in", "grouped", "pricing"] as const
          ).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              <VendorReportsPerTypeTab
                tab={tab}
                vendorId={vendorId}
                dateRange={dateRange}
                selectedContract={selectedContract}
              />
            </TabsContent>
          ))}

          <TabsContent value="by_rebate_type" className="mt-4">
            <VendorReportsByRebateTypeTab vendorId={vendorId} />
          </TabsContent>

          <TabsContent value="calculations" className="mt-4">
            <VendorReportsCalculationsTab
              vendorId={vendorId}
              contracts={facilityScopedContracts}
              selectedContract={selectedContract}
              onSelectContract={setSelectedContractId}
            />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
