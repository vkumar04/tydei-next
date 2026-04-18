"use client"

import { TabsList, TabsTrigger } from "@/components/ui/tabs"
import type { ReportTabKey, ReportsContract } from "./reports-types"

/**
 * Computes which tabs are visible based on the currently selected
 * contract, and renders the TabsList used by the hub.
 *
 * Rules (per spec §4.1):
 *   - "all" contracts → every tab visible.
 *   - Specific contract → only Overview, Calculations, and the tab
 *     matching the contract's type.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.1
 */
export interface ReportsTabRouterProps {
  selectedContract: ReportsContract | null
}

const ALL_TABS: { value: ReportTabKey; label: string }[] = [
  { value: "overview", label: "Overview" },
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing", label: "Pricing" },
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

export function computeAvailableTabs(
  selectedContract: ReportsContract | null,
): ReportTabKey[] {
  if (!selectedContract) {
    return ALL_TABS.map((t) => t.value)
  }
  const typeTab = TYPE_TO_TAB[selectedContract.contractType]
  const base: ReportTabKey[] = ["overview", "calculations"]
  return typeTab ? [typeTab, ...base] : base
}

export function ReportsTabRouter({ selectedContract }: ReportsTabRouterProps) {
  const available = new Set<ReportTabKey>(computeAvailableTabs(selectedContract))
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
