"use client"

/**
 * Case Costing — top-level tab dispatch.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4 subsystems 2-5.
 *
 * Pure presentational; receives fully-resolved props from the orchestrator
 * and hands each tab its slice. (Exception: the Payor Contracts tab is
 * self-fetching — PayorContractsManager owns its own TanStack Query
 * state via usePayorContracts + the payor-contract mutation hooks.)
 */
import { Stethoscope, User, TrendingUp, ShieldCheck, FileText } from "lucide-react"
import { useSearchParams } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CasesListTab } from "./cases-list-tab"
import { SurgeonsTab } from "./surgeons-tab"
import { FinancialTab } from "./financial-tab"
import { ComplianceTab } from "./compliance-tab"
import { PayorContractsManager } from "./payor-contracts-manager"
import type { GetCasesForFacilityFilters } from "@/lib/actions/case-costing/cases-list"
import type { Surgeon } from "@/lib/case-costing/surgeon-derivation"
import type { FacilityAverages } from "@/lib/case-costing/facility-averages"
import type { PayorMixSummary } from "@/lib/case-costing/payor-mix"
import type { FacilityCaseComplianceResult } from "@/lib/actions/case-costing/compliance"
import type { CaseRow } from "./case-costing-types"

export interface CaseCostingTabsProps {
  /** Needed by the Payor Contracts tab (create payload carries it). */
  facilityId: string
  cases: {
    data: CaseRow[]
    isLoading: boolean
    filters: GetCasesForFacilityFilters
    onFiltersChange: (next: GetCasesForFacilityFilters) => void
  }
  surgeons: {
    scorecards: Surgeon[]
    isLoading: boolean
    payorMix: PayorMixSummary | null
  }
  financial: {
    averages: FacilityAverages | null
    scorecards: Surgeon[]
    isLoading: boolean
  }
  compliance: {
    data: FacilityCaseComplianceResult | null
    isLoading: boolean
  }
}

export function CaseCostingTabs({
  facilityId,
  cases,
  surgeons,
  financial,
  compliance,
}: CaseCostingTabsProps) {
  // bugs.rtfd 2026-06-14: honor ?tab= so the Import Data modal's "Payor
  // Contracts" link deep-links straight to that tab.
  const tabParam = useSearchParams().get("tab")
  const validTabs = new Set([
    "cases",
    "surgeons",
    "financial",
    "compliance",
    "payor-contracts",
  ])
  const initialTab = tabParam && validTabs.has(tabParam) ? tabParam : "cases"
  return (
    <Tabs defaultValue={initialTab} className="w-full">
      <TabsList>
        <TabsTrigger value="cases" className="gap-2">
          <Stethoscope className="h-4 w-4" />
          Cases
        </TabsTrigger>
        <TabsTrigger value="surgeons" className="gap-2">
          <User className="h-4 w-4" />
          Surgeons
        </TabsTrigger>
        <TabsTrigger value="financial" className="gap-2">
          <TrendingUp className="h-4 w-4" />
          Financial
        </TabsTrigger>
        <TabsTrigger value="compliance" className="gap-2">
          <ShieldCheck className="h-4 w-4" />
          Compliance
        </TabsTrigger>
        <TabsTrigger value="payor-contracts" className="gap-2">
          <FileText className="h-4 w-4" />
          Payor Contracts
        </TabsTrigger>
      </TabsList>

      <TabsContent value="cases" className="mt-6 space-y-4">
        <CasesListTab {...cases} />
      </TabsContent>
      <TabsContent value="surgeons" className="mt-6 space-y-4">
        <SurgeonsTab {...surgeons} />
      </TabsContent>
      <TabsContent value="financial" className="mt-6 space-y-4">
        <FinancialTab {...financial} />
      </TabsContent>
      <TabsContent value="compliance" className="mt-6 space-y-4">
        <ComplianceTab {...compliance} />
      </TabsContent>
      <TabsContent value="payor-contracts" className="mt-6 space-y-4">
        <PayorContractsManager facilityId={facilityId} />
      </TabsContent>
    </Tabs>
  )
}
