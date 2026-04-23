"use client"

/**
 * Case Costing — client orchestrator (≤250 lines).
 *
 * Per docs/superpowers/specs/2026-04-18-case-costing-rewrite.md §4 subsystems 1-5.
 *
 * Renders the "hero + tabs" pattern (matching Analysis, Rebate Optimizer,
 * Contracts, Dashboard):
 *   - CaseCostingHero: 4 KPIs sourced from facility averages + compliance
 *     summary (no extra server round-trips — reuses the data the tabs already
 *     fetch).
 *   - Action strip (Reports / Upload).
 *   - PayorContractMarginCard.
 *   - CaseCostingTabs.
 *
 * All data fetching lives in `@/lib/actions/case-costing/*` server actions;
 * filter / sort / derivation logic lives in `@/lib/case-costing/*` pure helpers.
 */
import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import { Upload, BarChart3 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { CaseImportDialog } from "./case-import-dialog"
import { CaseCostingHero } from "./case-costing-hero"
import { CaseCostingTabs } from "./case-costing-tabs"
import { PayorContractMarginCard } from "./payor-contract-margin-card"
import {
  getCasesForFacility,
  getSurgeonsForFacility,
  getCptCodesForFacility,
} from "@/lib/actions/case-costing/cases-list"
import {
  getSurgeonScorecardsForFacility,
  getFacilityAveragesForFacility,
} from "@/lib/actions/case-costing/surgeons"
import { getFacilityCaseCompliance } from "@/lib/actions/case-costing/compliance"
import { getFacilityPayorMix } from "@/lib/actions/case-costing/payor-mix"
import type { GetCasesForFacilityFilters } from "@/lib/actions/case-costing/cases-list"
import type { CaseRow } from "./case-costing-types"

interface CaseCostingClientProps {
  facilityId: string
  facilityName: string
}

export function CaseCostingClient({
  facilityId,
  facilityName,
}: CaseCostingClientProps) {
  const [importOpen, setImportOpen] = useState(false)

  // Cases list tab — filters live here so both the filters bar and the table
  // can read/mutate the same object.
  const [caseFilters, setCaseFilters] = useState<GetCasesForFacilityFilters>({})

  const casesQuery = useQuery({
    queryKey: [
      "case-costing",
      "cases",
      facilityId,
      caseFilters,
    ] as const,
    queryFn: () => getCasesForFacility(caseFilters),
  })

  const surgeonOptionsQuery = useQuery({
    queryKey: ["case-costing", "surgeon-options", facilityId] as const,
    queryFn: () => getSurgeonsForFacility(),
  })

  const cptOptionsQuery = useQuery({
    queryKey: ["case-costing", "cpt-options", facilityId] as const,
    queryFn: () => getCptCodesForFacility(),
  })

  const scorecardsQuery = useQuery({
    queryKey: ["case-costing", "surgeon-scorecards", facilityId] as const,
    queryFn: () => getSurgeonScorecardsForFacility(),
  })

  const averagesQuery = useQuery({
    queryKey: ["case-costing", "facility-averages", facilityId] as const,
    queryFn: () => getFacilityAveragesForFacility(),
  })

  const complianceQuery = useQuery({
    queryKey: ["case-costing", "compliance", facilityId] as const,
    queryFn: () => getFacilityCaseCompliance(),
  })

  const payorMixQuery = useQuery({
    queryKey: ["case-costing", "payor-mix", facilityId] as const,
    queryFn: () => getFacilityPayorMix(),
  })

  const heroStats = useMemo(() => {
    const totalCases = complianceQuery.data?.perCase.length ?? 0
    const averages = averagesQuery.data
    const summary = complianceQuery.data?.summary
    return {
      totalCases,
      avgCostPerCase: averages?.avgCaseCost ?? 0,
      avgMarginPct: averages?.avgMarginPct ?? 0,
      onContractPct: summary?.compliancePercent ?? 0,
      lowComplianceCases: summary?.casesWithLowCompliance ?? 0,
    }
  }, [averagesQuery.data, complianceQuery.data])

  const heroLoading = averagesQuery.isLoading || complianceQuery.isLoading

  return (
    <div className="space-y-6">
      <CaseCostingHero
        totalCases={heroStats.totalCases}
        avgCostPerCase={heroStats.avgCostPerCase}
        avgMarginPct={heroStats.avgMarginPct}
        onContractPct={heroStats.onContractPct}
        lowComplianceCases={heroStats.lowComplianceCases}
        scopeLabel={facilityName}
        isLoading={heroLoading}
      />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/dashboard/case-costing/reports">
          <Button variant="outline">
            <BarChart3 className="mr-2 h-4 w-4" />
            Reports
          </Button>
        </Link>
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Data
        </Button>
      </div>

      <PayorContractMarginCard />

      <CaseCostingTabs
        cases={{
          data: (casesQuery.data ?? []) as unknown as CaseRow[],
          isLoading: casesQuery.isLoading,
          filters: caseFilters,
          onFiltersChange: setCaseFilters,
          surgeonOptions: surgeonOptionsQuery.data ?? [],
          cptOptions: cptOptionsQuery.data ?? [],
        }}
        surgeons={{
          scorecards: scorecardsQuery.data ?? [],
          isLoading: scorecardsQuery.isLoading,
          payorMix: payorMixQuery.data ?? null,
        }}
        financial={{
          averages: averagesQuery.data ?? null,
          scorecards: scorecardsQuery.data ?? [],
          isLoading:
            averagesQuery.isLoading || scorecardsQuery.isLoading,
        }}
        compliance={{
          data: complianceQuery.data ?? null,
          isLoading: complianceQuery.isLoading,
        }}
      />

      <CaseImportDialog
        facilityId={facilityId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {
          casesQuery.refetch()
          scorecardsQuery.refetch()
          averagesQuery.refetch()
          complianceQuery.refetch()
          payorMixQuery.refetch()
        }}
      />
    </div>
  )
}
