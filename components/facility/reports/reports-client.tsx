"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Tabs, TabsContent } from "@/components/ui/tabs"
import { queryKeys } from "@/lib/query-keys"
import { getContracts } from "@/lib/actions/reports"
import { getVendors } from "@/lib/actions/vendors"
import { ReportsFilterBar } from "./reports-filter-bar"
import {
  ReportsTabRouter,
  computeAvailableTabs,
} from "./reports-tab-router"
import { ReportsOverviewTab } from "./reports-overview-tab"
import { ReportsPerTypeTab } from "./reports-per-type-tab"
import { ReportsCalculationsTab } from "./reports-calculations-tab"
import { ReportsQuickAccessCards } from "./reports-quick-access-cards"
import { ReportsScheduleDialog } from "./reports-schedule-dialog"
import type {
  ReportsContract,
  ReportsDateRange,
  ReportTabKey,
} from "./reports-types"

/**
 * Reports Hub orchestrator. Owns:
 *   - Filter state (vendor, contract, date range)
 *   - Active tab + auto-routing on contract change
 *   - Schedule dialog open state
 *
 * Per-tab data fetching lives inside each tab component so the hub
 * stays focused on composition.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.1
 */
export interface ReportsClientProps {
  facilityId: string
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

export function ReportsClient({ facilityId }: ReportsClientProps) {
  const [dateRange, setDateRange] = useState<ReportsDateRange>(defaultRange)
  const [selectedVendorId, setSelectedVendorId] = useState("all")
  const [selectedContractId, setSelectedContractId] = useState("all")
  const [activeTab, setActiveTab] = useState<ReportTabKey>("overview")
  const [scheduleOpen, setScheduleOpen] = useState(false)

  const { data: contractsRaw } = useQuery({
    queryKey: queryKeys.contracts.list(facilityId, { hub: true }),
    queryFn: () => getContracts(facilityId),
  })

  const { data: vendorsRaw } = useQuery({
    queryKey: queryKeys.vendors.list({ hub: true }),
    queryFn: () => getVendors(),
  })

  const contracts = useMemo<ReportsContract[]>(() => {
    return (contractsRaw ?? []) as ReportsContract[]
  }, [contractsRaw])

  const vendors = useMemo<{ id: string; name: string }[]>(() => {
    const rows = (vendorsRaw ?? []) as { id: string; name: string }[]
    return rows.map((v) => ({ id: v.id, name: v.name }))
  }, [vendorsRaw])

  const selectedContract = useMemo<ReportsContract | null>(
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
    const available = new Set(computeAvailableTabs(selectedContract))
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

  function handleVendorChange(vendorId: string) {
    setSelectedVendorId(vendorId)
    // Reset contract selection when the vendor changes.
    setSelectedContractId("all")
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reports</h1>
        <p className="text-muted-foreground">
          Multi-contract performance reporting hub
        </p>
      </div>

      <ReportsQuickAccessCards
        onOpenScheduledReports={() => setScheduleOpen(true)}
      />

      <ReportsFilterBar
        dateRange={dateRange}
        onDateRangeChange={setDateRange}
        selectedVendorId={selectedVendorId}
        onVendorChange={handleVendorChange}
        selectedContractId={selectedContractId}
        onContractChange={setSelectedContractId}
        vendors={vendors}
        contracts={contracts}
      />

      <div id="reports-tabs">
        <Tabs
          value={activeTab}
          onValueChange={(v) => setActiveTab(v as ReportTabKey)}
        >
          <ReportsTabRouter selectedContract={selectedContract} />

          <TabsContent value="overview" className="mt-4">
            <ReportsOverviewTab
              facilityId={facilityId}
              dateRange={dateRange}
            />
          </TabsContent>

          {(
            ["usage", "capital", "service", "tie_in", "grouped", "pricing"] as const
          ).map((tab) => (
            <TabsContent key={tab} value={tab} className="mt-4">
              <ReportsPerTypeTab
                tab={tab}
                facilityId={facilityId}
                dateRange={dateRange}
                selectedContract={selectedContract}
              />
            </TabsContent>
          ))}

          <TabsContent value="calculations" className="mt-4">
            <ReportsCalculationsTab
              contracts={contracts}
              selectedContract={selectedContract}
              onSelectContract={setSelectedContractId}
            />
          </TabsContent>
        </Tabs>
      </div>

      <ReportsScheduleDialog
        facilityId={facilityId}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
      />
    </div>
  )
}
