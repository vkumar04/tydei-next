"use client"

/**
 * Case Costing — top-level tab dispatch.
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4 subsystems 2-5.
 *
 * Pure presentational; receives fully-resolved props from the orchestrator
 * and hands each tab its slice.
 */
import { Stethoscope, User, TrendingUp, ShieldCheck } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CasesListTab } from "./cases-list-tab"
import { SurgeonsTab } from "./surgeons-tab"
import { FinancialTab } from "./financial-tab"
import { ComplianceTab } from "./compliance-tab"
import type { GetCasesForFacilityFilters } from "@/lib/actions/case-costing/cases-list"
import type { Surgeon } from "@/lib/case-costing/surgeon-derivation"
import type { FacilityAverages } from "@/lib/case-costing/facility-averages"
import type { PayorMixSummary } from "@/lib/case-costing/payor-mix"
import type { FacilityCaseComplianceResult } from "@/lib/actions/case-costing/compliance"
import type { CaseRow } from "./case-costing-types"

export interface CaseCostingTabsProps {
  cases: {
    data: CaseRow[]
    isLoading: boolean
    filters: GetCasesForFacilityFilters
    onFiltersChange: (next: GetCasesForFacilityFilters) => void
    surgeonOptions: string[]
    cptOptions: string[]
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
  cases,
  surgeons,
  financial,
  compliance,
}: CaseCostingTabsProps) {
  return (
    <Tabs defaultValue="cases" className="w-full">
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
    </Tabs>
  )
}
