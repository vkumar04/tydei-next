"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import Link from "next/link"
import {
  Upload,
  Stethoscope,
  DollarSign,
  TrendingUp,
  User,
  BarChart3,
  CheckCircle2,
} from "lucide-react"
import { CaseTable } from "./case-table"
import { SurgeonScorecardsGrid } from "./surgeon-scorecards-grid"
import { CaseImportDialog } from "./case-import-dialog"
import {
  useSurgeonScorecards,
  useCaseCostingReport,
} from "@/hooks/use-case-costing"

interface CaseCostingClientProps {
  facilityId: string
}

export function CaseCostingClient({ facilityId }: CaseCostingClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [activeMainTab, setActiveMainTab] = useState("cases")
  const { data: scorecards, isLoading: scLoading } =
    useSurgeonScorecards(facilityId)
  const { data: report, isLoading: reportLoading } =
    useCaseCostingReport(facilityId)

  const totalCases = report?.totalCases ?? 0
  const avgCostPerCase = report?.avgCostPerCase ?? 0
  const totalSpend = report?.totalSpend ?? 0
  const totalMargin = report?.avgMargin
    ? report.avgMargin * totalCases
    : 0
  const avgMarginPercent =
    report?.totalReimbursement && report.totalReimbursement > 0
      ? ((report.totalReimbursement - totalSpend) / report.totalReimbursement) *
        100
      : 0
  const complianceRate = report?.complianceRate ?? 0
  const totalReimbursement = report?.totalReimbursement ?? 0
  const surgeonCount = scorecards?.length ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Case Costing &amp; Surgeon Performance
          </h1>
          <p className="text-muted-foreground">
            Track case margins, surgeon performance metrics, and rebate
            contributions
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/f/${facilityId}/case-costing/reports`}>
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
      </div>

      {/* Main Tabs */}
      <Tabs value={activeMainTab} onValueChange={setActiveMainTab}>
        <TabsList>
          <TabsTrigger value="cases" className="gap-2">
            <Stethoscope className="h-4 w-4" />
            Cases
          </TabsTrigger>
          <TabsTrigger value="surgeons" className="gap-2">
            <User className="h-4 w-4" />
            Surgeon Scorecard
          </TabsTrigger>
        </TabsList>

        {/* Cases Tab */}
        <TabsContent value="cases" className="space-y-6 mt-6">
          {/* Summary Cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Cases
                </CardTitle>
                <Stethoscope className="h-4 w-4 text-muted-foreground" />
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
                      Avg spend: $
                      {Math.round(avgCostPerCase).toLocaleString()}/case
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Margin
                </CardTitle>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <Skeleton className="h-8 w-24" />
                ) : (
                  <>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      ${Math.round(totalMargin).toLocaleString()}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {avgMarginPercent.toFixed(1)}% margin rate
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Contract Compliance
                </CardTitle>
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                {reportLoading ? (
                  <Skeleton className="h-8 w-20" />
                ) : (
                  <>
                    <div className="text-2xl font-bold">
                      {complianceRate.toFixed(1)}%
                    </div>
                    <p className="text-xs text-muted-foreground">
                      On-contract cases
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">
                  Total Spend
                </CardTitle>
                <DollarSign className="h-4 w-4 text-muted-foreground" />
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
                      Reimb: ${Math.round(totalReimbursement).toLocaleString()}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Cases Table */}
          <CaseTable facilityId={facilityId} />
        </TabsContent>

        {/* Surgeon Scorecard Tab */}
        <TabsContent value="surgeons" className="space-y-6 mt-6">
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

