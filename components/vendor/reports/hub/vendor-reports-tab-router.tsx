"use client"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReportTabKey, VendorReportsContract } from "./vendor-reports-types"

/**
 * Computes which tabs are visible based on the currently selected
 * contract, and renders the TabsList used by the Vendor Reports Hub.
 *
 * Same rules as the facility hub (`computeAvailableTabs`):
 *   - "all" / no contract → every tab visible.
 *   - Specific contract → only Overview, Calculations, and the tab
 *     matching the contract's type.
 *   - "By Rebate Type" only makes sense at the vendor-wide level.
 */
export interface VendorReportsTabRouterProps {
  selectedContract: VendorReportsContract | null
}

const ALL_TABS: { value: ReportTabKey; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing", label: "Pricing" },
  { value: "by_rebate_type", label: "By Rebate Type" },
  { value: "calculations", label: "Calculations" },
]

const TYPE_TO_TAB: Record<string, ReportTabKey> = {
  usage: "usage",
  capital: "capital",
  service: "service",
  tie_in: "tie_in",
  grouped: "grouped",
  pricing_only: "pricing",
}

export function computeAvailableVendorTabs(
  selectedContract: VendorReportsContract | null,
): ReportTabKey[] {
  if (!selectedContract) {
    return ALL_TABS.map((t) => t.value)
  }
  const typeTab = TYPE_TO_TAB[selectedContract.contractType]
  const base: ReportTabKey[] = ["overview", "calculations"]
  return typeTab ? [typeTab, ...base] : base
}

export function VendorReportsTabRouter({
  selectedContract,
}: VendorReportsTabRouterProps) {
  const available = new Set<ReportTabKey>(
    computeAvailableVendorTabs(selectedContract),
  )
  const visibleTabs = ALL_TABS.filter((t) => available.has(t.value))

  return (
    <TabsList className="h-auto flex-wrap gap-1 p-1">
      {visibleTabs.map((t) => (
        <TabsTrigger key={t.value} value={t.value} className="px-4 py-2">
          {t.label}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
