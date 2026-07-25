"use client"

/**
 * Case Costing — client orchestrator (≤250 lines).
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
import { Upload, BarChart3, Trash2, Loader2, PencilLine } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { useDeleteAllCases } from "@/hooks/use-case-costing"
import { CaseImportDialog } from "./case-import-dialog"
import { ManualCaseEntryDialog } from "./manual-case-entry-dialog"
import { CaseCostingHero } from "./case-costing-hero"
import { CaseCostingTabs } from "./case-costing-tabs"
import { PayorContractMarginCard } from "./payor-contract-margin-card"
import { getCasesForFacility } from "@/lib/actions/case-costing/cases-list"
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
  const [manualOpen, setManualOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const deleteAll = useDeleteAllCases()

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

  // Refetch every case-costing surface. These queries use the
  // ["case-costing", …] key namespace (not queryKeys.cases.*), so the
  // mutation hooks' invalidate(["cases"]) doesn't reach them — refetch
  // explicitly after an import or a delete-all.
  function refetchAll() {
    casesQuery.refetch()
    scorecardsQuery.refetch()
    averagesQuery.refetch()
    complianceQuery.refetch()
    payorMixQuery.refetch()
  }

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
        <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
          <AlertDialogTrigger asChild>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={heroStats.totalCases === 0 || deleteAll.isPending}
            >
              {deleteAll.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="mr-2 h-4 w-4" />
              )}
              Delete All Cases
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                Delete all {heroStats.totalCases.toLocaleString()} case
                {heroStats.totalCases === 1 ? "" : "s"}?
              </AlertDialogTitle>
              <AlertDialogDescription>
                This permanently removes every case, along with its supplies
                and procedures, for {facilityName}. Payor contracts are not
                affected. This cannot be undone — re-import to restore data.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={deleteAll.isPending}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                disabled={deleteAll.isPending}
                onClick={(e) => {
                  // Keep the dialog open until the mutation resolves so the
                  // user sees the pending state; close on success.
                  e.preventDefault()
                  deleteAll.mutate(undefined, {
                    onSuccess: () => {
                      refetchAll()
                      setDeleteOpen(false)
                    },
                  })
                }}
              >
                {deleteAll.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Delete all cases
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        <Button variant="outline" onClick={() => setManualOpen(true)}>
          <PencilLine className="mr-2 h-4 w-4" />
          Manual entry
        </Button>
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="mr-2 h-4 w-4" />
          Upload Data
        </Button>
      </div>

      <PayorContractMarginCard />

      <CaseCostingTabs
        facilityId={facilityId}
        cases={{
          data: (casesQuery.data ?? []) as unknown as CaseRow[],
          isLoading: casesQuery.isLoading,
          filters: caseFilters,
          onFiltersChange: setCaseFilters,
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
        onComplete={refetchAll}
      />

      <ManualCaseEntryDialog
        facilityId={facilityId}
        open={manualOpen}
        onOpenChange={setManualOpen}
        onComplete={refetchAll}
      />
    </div>
  )
}
