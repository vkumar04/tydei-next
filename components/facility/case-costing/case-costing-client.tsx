"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import Link from "next/link"
import {
  Upload,
  Stethoscope,
  DollarSign,
  TrendingUp,
  User,
  BarChart3,
  CheckCircle2,
  FileHeart,
  Trash2,
} from "lucide-react"
import { CaseTable } from "./case-table"
import { SurgeonScorecardsGrid } from "./surgeon-scorecards-grid"
import { CaseImportDialog } from "./case-import-dialog"
import { PayorContractsManager } from "./payor-contracts-manager"
import {
  useSurgeonScorecards,
  useCaseCostingReport,
  usePayorContracts,
  usePayorMargins,
  useDeleteAllCases,
} from "@/hooks/use-case-costing"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { cn } from "@/lib/utils"

interface CaseCostingClientProps {
  facilityId: string
}

export function CaseCostingClient({ facilityId }: CaseCostingClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false)
  const [activeMainTab, setActiveMainTab] = useState("cases")
  const [selectedPayorId, setSelectedPayorId] = useState<string | null>(null)
  const { data: scorecards, isLoading: scLoading } =
    useSurgeonScorecards(facilityId)
  const { data: report, isLoading: reportLoading } =
    useCaseCostingReport(facilityId)
  const { data: payorContracts } = usePayorContracts()
  const { data: payorMargins } = usePayorMargins(selectedPayorId)
  const deleteAllMutation = useDeleteAllCases()

  const totalCases = report?.totalCases ?? 0
  const avgCostPerCase = report?.avgCostPerCase ?? 0
  const totalSpend = report?.totalSpend ?? 0
  // Only show reimbursement-derived values when a payor contract is actually
  // loaded and selected — otherwise we'd be showing numbers derived from
  // stored reimbursement estimates that have no relation to a real contract.
  const hasPayorContractLoaded =
    !!payorMargins &&
    !!selectedPayorId &&
    payorMargins.totalEstimatedReimbursement > 0
  const totalReimbursement = hasPayorContractLoaded
    ? payorMargins.totalEstimatedReimbursement
    : 0
  const totalMargin = hasPayorContractLoaded ? payorMargins.totalMargin : 0
  const avgMarginPercent = hasPayorContractLoaded
    ? payorMargins.avgMarginPercent
    : 0
  const complianceRate = report?.complianceRate ?? 0

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
          <Link href="/dashboard/case-costing/reports">
            <Button variant="outline">
              <BarChart3 className="mr-2 h-4 w-4" />
              Reports
            </Button>
          </Link>
          {totalCases > 0 && (
            <Button
              variant="outline"
              onClick={() => setClearConfirmOpen(true)}
              disabled={deleteAllMutation.isPending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Clear Prior Data
            </Button>
          )}
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
          <TabsTrigger value="payor-contracts" className="gap-2">
            <FileHeart className="h-4 w-4" />
            Payor Contracts
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
                    {hasPayorContractLoaded ? (
                      <>
                        <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                          ${Math.round(totalMargin).toLocaleString()}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {avgMarginPercent.toFixed(1)}% margin rate
                        </p>
                      </>
                    ) : (
                      <>
                        <div className="text-2xl font-bold text-muted-foreground">
                          —
                        </div>
                        <p className="text-xs text-muted-foreground">
                          Load a payor contract
                        </p>
                      </>
                    )}
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
                      {hasPayorContractLoaded
                        ? `Reimb: $${Math.round(totalReimbursement).toLocaleString()}`
                        : `${totalCases.toLocaleString()} cases`}
                    </p>
                  </>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Payor Contract Margin Analysis */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <div>
                <CardTitle className="text-base flex items-center gap-2">
                  <FileHeart className="h-4 w-4" />
                  Payor Contract Margin
                </CardTitle>
                <p className="text-xs text-muted-foreground mt-1">
                  Select a payor contract to calculate expected margins based on CPT rates
                </p>
              </div>
              <Select
                value={selectedPayorId ?? ""}
                onValueChange={(v) => setSelectedPayorId(v || null)}
              >
                <SelectTrigger className="w-[220px]">
                  <SelectValue placeholder="Select payor contract" />
                </SelectTrigger>
                <SelectContent>
                  {payorContracts?.map((pc) => (
                    <SelectItem key={pc.id} value={pc.id}>
                      {pc.payorName}
                    </SelectItem>
                  ))}
                  {(!payorContracts || payorContracts.length === 0) && (
                    <div className="p-2 text-sm text-muted-foreground text-center">
                      No payor contracts found
                    </div>
                  )}
                </SelectContent>
              </Select>
            </CardHeader>
            {payorMargins && (
              <CardContent>
                <div className="grid gap-3 sm:grid-cols-4">
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Est. Reimbursement</p>
                    <p className="text-lg font-bold">
                      ${Math.round(payorMargins.totalEstimatedReimbursement).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Est. Total Margin</p>
                    <p className={cn(
                      "text-lg font-bold",
                      payorMargins.totalMargin >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    )}>
                      ${Math.round(payorMargins.totalMargin).toLocaleString()}
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">Avg Margin %</p>
                    <p className={cn(
                      "text-lg font-bold",
                      payorMargins.avgMarginPercent >= 0
                        ? "text-green-600 dark:text-green-400"
                        : "text-red-600 dark:text-red-400"
                    )}>
                      {payorMargins.avgMarginPercent.toFixed(1)}%
                    </p>
                  </div>
                  <div className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">CPT Matched</p>
                    <p className="text-lg font-bold">
                      {payorMargins.matchedCases}
                      <span className="text-sm font-normal text-muted-foreground">
                        /{payorMargins.totalCases}
                      </span>
                    </p>
                  </div>
                </div>
              </CardContent>
            )}
          </Card>

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

        {/* Payor Contracts Tab */}
        <TabsContent value="payor-contracts" className="space-y-6 mt-6">
          <PayorContractsManager facilityId={facilityId} />
        </TabsContent>
      </Tabs>

      <CaseImportDialog
        facilityId={facilityId}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {}}
      />

      <ConfirmDialog
        open={clearConfirmOpen}
        onOpenChange={setClearConfirmOpen}
        title="Clear all prior case data?"
        description={`This will permanently delete all ${totalCases.toLocaleString()} cases and their supplies for this facility. This cannot be undone.`}
        variant="destructive"
        isLoading={deleteAllMutation.isPending}
        onConfirm={async () => {
          await deleteAllMutation.mutateAsync()
          setClearConfirmOpen(false)
        }}
      />
    </div>
  )
}

