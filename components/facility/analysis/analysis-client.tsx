"use client"

import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Loader2 } from "lucide-react"
import { getContracts } from "@/lib/actions/contracts"
import {
  analyzeCapitalContract,
  type AnalyzeCapitalContractResult,
} from "@/lib/actions/financial-analysis"
import { queryKeys } from "@/lib/query-keys"
import { AnalysisInputForm, type AnalysisFormState } from "./analysis-input-form"
import { AnalysisResultsPanel } from "./analysis-results-panel"
import { AnalysisDepreciationTable } from "./analysis-depreciation-table"
import { AnalysisCashflowChart } from "./analysis-cashflow-chart"
import { AnalysisNarrativeCard } from "./analysis-narrative-card"
import { AnalysisClauseRiskCard } from "./analysis-clause-risk-card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"

/**
 * Financial-analysis orchestrator (subsystems 1-7).
 *
 * Responsibilities:
 *   1. Load the facility's active contracts for the picker (subsystem 2).
 *   2. Hold form state + call `analyzeCapitalContract` whenever inputs
 *      settle (subsystems 1 + 3).
 *   3. Lay out the result cards: KPI panel, depreciation, cashflow,
 *      narrative, and (when available) clause-risk adjustment.
 *
 * Keeps under 200 lines by delegating rendering to the six dedicated
 * child components — this file is pure glue.
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

  const analyzeQuery = useQuery<AnalyzeCapitalContractResult>({
    queryKey: [
      "financialAnalysis",
      "capital",
      form.contractId,
      form.discountRate,
      form.taxRate,
      form.annualSpend,
      form.rebateRate,
      form.growthRatePerYear,
      form.marketDeclineRate,
      form.payUpfront,
    ],
    queryFn: () =>
      analyzeCapitalContract({
        contractId: form.contractId as string,
        discountRate: form.discountRate / 100,
        taxRate: form.taxRate / 100,
        annualSpend: form.annualSpend,
        rebateRate: form.rebateRate / 100,
        growthRatePerYear: form.growthRatePerYear / 100,
        marketDeclineRate: form.marketDeclineRate / 100,
        payUpfront: form.payUpfront,
      }),
    enabled: !!form.contractId,
    staleTime: 60_000,
  })

  const result = analyzeQuery.data

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
      <div className="space-y-4">
        <AnalysisInputForm
          contracts={contractOptions}
          contractsLoading={contractsQuery.isLoading}
          value={form}
          onChange={setForm}
          showPayUpfront={isCapital}
        />
      </div>

      <div className="space-y-6">
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
              Pick an active contract from the form to run a capital ROI
              analysis.
            </AlertDescription>
          </Alert>
        )}

        {analyzeQuery.isFetching && !result && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Computing analysis...
          </div>
        )}

        {result && (
          <>
            <AnalysisResultsPanel
              npv={result.roi.npv}
              irr={result.roi.irr}
              discountRate={form.discountRate / 100}
              verdict={result.narrative.verdict}
              headline={result.narrative.headline}
            />
            <div className="grid gap-6 xl:grid-cols-2">
              <AnalysisCashflowChart cashflows={result.roi.cashflows} />
              <AnalysisNarrativeCard narrative={result.narrative} />
            </div>
            <AnalysisDepreciationTable schedule={result.roi.depreciation} />
            {result.riskAdjustedNPV && (
              <AnalysisClauseRiskCard adjusted={result.riskAdjustedNPV} />
            )}
          </>
        )}
      </div>
    </div>
  )
}
