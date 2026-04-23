"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery, keepPreviousData } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { getContracts } from "@/lib/actions/contracts"
import {
  analyzeCapitalContract,
  type AnalyzeCapitalContractResult,
} from "@/lib/actions/financial-analysis"
import { queryKeys } from "@/lib/query-keys"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import {
  AnalysisControlBar,
  type AnalysisFormState,
} from "./analysis-control-bar"
import { AnalysisHero } from "./analysis-hero"
import { AnalysisDepreciationTable } from "./analysis-depreciation-table"
import { AnalysisCashflowChart } from "./analysis-cashflow-chart"
import { AnalysisClauseRiskCard } from "./analysis-clause-risk-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

/**
 * Financial-analysis orchestrator.
 *
 * New layout (2026-04-22 redesign, Pattern 1 — hero + tabbed details):
 *
 *   1. Horizontal ControlBar at the top: contract picker + inline stat
 *      summary + "Assumptions" popover for full numeric inputs.
 *   2. AnalysisHero — verdict, three big numbers (NPV / IRR / Verdict),
 *      headline, narrative bullets, risks, and recommendation all in one
 *      elevated panel.
 *   3. Supporting detail tabs — Cashflow, Depreciation, Clause risk
 *      (conditional). One panel visible at a time cuts the "card farm"
 *      feel the old stacked layout had.
 *
 * Replaces the old 360px-sidebar + stacked-results grid.
 */
export interface AnalysisClientProps {
  facilityId: string
}

const DEFAULT_FORM: AnalysisFormState = {
  contractId: null,
  discountRate: 8,
  taxRate: 21,
  annualSpend: 100_000,
  rebateRate: 3.5,
  growthRatePerYear: 3,
  marketDeclineRate: 2,
  payUpfront: false,
}

export function AnalysisClient({ facilityId }: AnalysisClientProps) {
  const [form, setForm] = useState<AnalysisFormState>(DEFAULT_FORM)

  const contractsQuery = useQuery({
    queryKey: queryKeys.contracts.list(facilityId, { status: "active" }),
    queryFn: () =>
      getContracts({
        facilityId,
        status: "active",
        page: 1,
        pageSize: 100,
      }),
  })

  const contractOptions = useMemo(
    () =>
      (contractsQuery.data?.contracts ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        vendorName: c.vendor?.name ?? "Unknown vendor",
        contractType: c.contractType,
      })),
    [contractsQuery.data],
  )

  const selectedContract = useMemo(
    () => contractOptions.find((c) => c.id === form.contractId) ?? null,
    [contractOptions, form.contractId],
  )
  const isCapital = selectedContract?.contractType === "capital"

  // Seed the form's contractId with the first active contract once loaded.
  useEffect(() => {
    if (!form.contractId && contractOptions.length > 0) {
      setForm((prev) => ({ ...prev, contractId: contractOptions[0].id }))
    }
  }, [contractOptions, form.contractId])

  // Debounce the form so rapid typing in the Assumptions popover doesn't
  // fire a server action on every keystroke. Contract-picker changes
  // and the pay-upfront toggle feel instant because those are
  // single-click interactions; the 350ms wait only affects numeric
  // inputs where the user is mid-typing. `keepPreviousData` smooths
  // the hero/tabs so they render the last good result during the
  // debounce window rather than flashing a spinner.
  const debouncedForm = useDebouncedValue(form, 350)

  const analyzeQuery = useQuery<AnalyzeCapitalContractResult>({
    queryKey: [
      "financialAnalysis",
      "capital",
      debouncedForm.contractId,
      debouncedForm.discountRate,
      debouncedForm.taxRate,
      debouncedForm.annualSpend,
      debouncedForm.rebateRate,
      debouncedForm.growthRatePerYear,
      debouncedForm.marketDeclineRate,
      debouncedForm.payUpfront,
    ],
    queryFn: () =>
      analyzeCapitalContract({
        contractId: debouncedForm.contractId as string,
        discountRate: debouncedForm.discountRate / 100,
        taxRate: debouncedForm.taxRate / 100,
        annualSpend: debouncedForm.annualSpend,
        rebateRate: debouncedForm.rebateRate / 100,
        growthRatePerYear: debouncedForm.growthRatePerYear / 100,
        marketDeclineRate: debouncedForm.marketDeclineRate / 100,
        payUpfront: debouncedForm.payUpfront,
      }),
    enabled: !!debouncedForm.contractId,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })

  const result = analyzeQuery.data

  return (
    <div className="flex flex-col gap-6">
      <AnalysisControlBar
        contracts={contractOptions}
        contractsLoading={contractsQuery.isLoading}
        value={form}
        onChange={setForm}
        showPayUpfront={isCapital}
      />

      {analyzeQuery.isError && (
        <Alert variant="destructive">
          <AlertTitle>Analysis failed</AlertTitle>
          <AlertDescription>
            {analyzeQuery.error instanceof Error
              ? analyzeQuery.error.message
              : "Unable to compute capital ROI."}
          </AlertDescription>
        </Alert>
      )}

      {!form.contractId && !contractsQuery.isLoading && (
        <Alert>
          <AlertTitle>Select a contract</AlertTitle>
          <AlertDescription>
            Pick an active contract from the control bar to run a capital ROI
            analysis.
          </AlertDescription>
        </Alert>
      )}

      {analyzeQuery.isFetching && !result && (
        <div className="flex items-center gap-2 rounded-lg border bg-card px-4 py-8 text-sm text-muted-foreground shadow-xs">
          <Loader2 className="h-4 w-4 animate-spin" />
          Computing analysis…
        </div>
      )}

      {result && (
        <>
          <AnalysisHero
            npv={result.roi.npv}
            irr={result.roi.irr}
            discountRate={form.discountRate / 100}
            verdict={result.narrative.verdict}
            narrative={result.narrative}
          />

          <Tabs defaultValue="cashflow" className="w-full">
            <TabsList>
              <TabsTrigger value="cashflow">Cashflow</TabsTrigger>
              <TabsTrigger value="depreciation">Depreciation</TabsTrigger>
              {result.riskAdjustedNPV && (
                <TabsTrigger value="risk">Clause risk</TabsTrigger>
              )}
            </TabsList>

            <TabsContent value="cashflow" className="mt-4">
              <AnalysisCashflowChart cashflows={result.roi.cashflows} />
            </TabsContent>
            <TabsContent value="depreciation" className="mt-4">
              <AnalysisDepreciationTable schedule={result.roi.depreciation} />
            </TabsContent>
            {result.riskAdjustedNPV && (
              <TabsContent value="risk" className="mt-4">
                <AnalysisClauseRiskCard adjusted={result.riskAdjustedNPV} />
              </TabsContent>
            )}
          </Tabs>
        </>
      )}
    </div>
  )
}
