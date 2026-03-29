"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Upload,
  Stethoscope,
  DollarSign,
  TrendingUp,
  Users,
  BarChart3,
  FileText,
} from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { CaseTable } from "./case-table"
import { SurgeonScorecardsGrid } from "./surgeon-scorecards-grid"
import { CPTAnalysisTable } from "./cpt-analysis-table"
import { CaseImportDialog } from "./case-import-dialog"
import {
  useSurgeonScorecards,
  useCPTAnalysis,
  useCaseCostingReport,
} from "@/hooks/use-case-costing"

interface CaseCostingClientProps {
  facilityId: string
}

export function CaseCostingClient({ facilityId }: CaseCostingClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const { data: scorecards, isLoading: scLoading } =
    useSurgeonScorecards(facilityId)
  const { data: cptData, isLoading: cptLoading } = useCPTAnalysis(facilityId)
  const { data: report, isLoading: reportLoading } =
    useCaseCostingReport(facilityId)

  const totalCases = report?.totalCases ?? 0
  const avgCostPerCase = report?.avgCostPerCase ?? 0
  const totalSpend = report?.totalSpend ?? 0
  const surgeonCount = scorecards?.length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Costing"
        description="Analyze surgical case costs, surgeon performance, and procedure trends"
        action={
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Import Cases
          </Button>
        }
      />

      {/* Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Cases</CardTitle>
            <Stethoscope className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Skeleton className="h-8 w-20" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  {totalCases.toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Surgical cases on record
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Avg Cost / Case
            </CardTitle>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  ${Math.round(avgCostPerCase).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Average spend per case
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Total Supplies Cost
            </CardTitle>
            <DollarSign className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {reportLoading ? (
              <Skeleton className="h-8 w-28" />
            ) : (
              <>
                <div className="text-2xl font-bold">
                  ${Math.round(totalSpend).toLocaleString()}
                </div>
                <p className="text-xs text-muted-foreground">
                  Total supply expenditure
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Surgeon Count</CardTitle>
            <Users className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {scLoading ? (
              <Skeleton className="h-8 w-12" />
            ) : (
              <>
                <div className="text-2xl font-bold">{surgeonCount}</div>
                <p className="text-xs text-muted-foreground">
                  Active surgeons
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="cases">
        <TabsList>
          <TabsTrigger value="cases" className="gap-1.5">
            <Stethoscope className="size-4" />
            Cases
          </TabsTrigger>
          <TabsTrigger value="surgeons" className="gap-1.5">
            <Users className="size-4" />
            Surgeons
          </TabsTrigger>
          <TabsTrigger value="cpt" className="gap-1.5">
            <BarChart3 className="size-4" />
            CPT Analysis
          </TabsTrigger>
          <TabsTrigger value="reports" className="gap-1.5">
            <FileText className="size-4" />
            Reports
          </TabsTrigger>
        </TabsList>

        {/* Cases Tab */}
        <TabsContent value="cases" className="mt-4">
          <CaseTable facilityId={facilityId} />
        </TabsContent>

        {/* Surgeons Tab */}
        <TabsContent value="surgeons" className="mt-4">
          {scLoading ? (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-[220px] rounded-xl" />
              ))}
            </div>
          ) : (
            <SurgeonScorecardsGrid
              scorecards={scorecards ?? []}
              avgCostPerCase={avgCostPerCase}
            />
          )}
        </TabsContent>

        {/* CPT Analysis Tab */}
        <TabsContent value="cpt" className="mt-4">
          {cptLoading ? (
            <Skeleton className="h-[400px] rounded-md" />
          ) : (
            <CPTAnalysisTable analyses={cptData ?? []} />
          )}
        </TabsContent>

        {/* Reports Tab */}
        <TabsContent value="reports" className="mt-4">
          <ReportsSummary report={report} isLoading={reportLoading} />
        </TabsContent>
      </Tabs>

      <CaseImportDialog
        facilityId={facilityId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {}}
      />
    </div>
  )
}

/* ── Reports Summary ─────────────────────────────────── */

import type { CaseCostingReport } from "@/lib/actions/cases"

function ReportsSummary({
  report,
  isLoading,
}: {
  report: CaseCostingReport | undefined
  isLoading: boolean
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[160px] rounded-xl" />
        ))}
      </div>
    )
  }

  if (!report || report.totalCases === 0) {
    return (
      <Card>
        <CardContent className="flex h-40 items-center justify-center text-muted-foreground">
          No report data available. Import cases to generate reports.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Key metrics row */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Average Margin</CardTitle>
          </CardHeader>
          <CardContent>
            <div
              className={`text-2xl font-bold ${report.avgMargin >= 0 ? "text-emerald-600" : "text-red-600"}`}
            >
              ${Math.round(report.avgMargin).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">Per case</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Total Reimbursement
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              ${Math.round(report.totalReimbursement).toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">All cases</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">
              Compliance Rate
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {Math.round(report.complianceRate)}%
            </div>
            <p className="text-xs text-muted-foreground">On-contract cases</p>
          </CardContent>
        </Card>
      </div>

      {/* Top Surgeons */}
      {report.topSurgeons.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Surgeons by Spend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {report.topSurgeons.slice(0, 5).map((s) => (
                <div
                  key={s.name}
                  className="flex items-center justify-between text-sm"
                >
                  <div>
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-2 text-muted-foreground">
                      {s.cases} cases
                    </span>
                  </div>
                  <span className="font-medium">
                    ${Math.round(s.spend).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly Trend */}
      {report.monthlyCosts.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly Cost Trend</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {report.monthlyCosts.map((m) => {
                const margin = m.reimbursement - m.spend
                return (
                  <div
                    key={m.month}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-muted-foreground">{m.month}</span>
                    <div className="flex gap-4">
                      <span>
                        Spend: ${Math.round(m.spend).toLocaleString()}
                      </span>
                      <span
                        className={
                          margin >= 0 ? "text-emerald-600" : "text-red-600"
                        }
                      >
                        Margin: ${Math.round(margin).toLocaleString()}
                      </span>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
