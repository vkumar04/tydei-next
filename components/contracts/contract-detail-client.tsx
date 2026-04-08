"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery } from "@tanstack/react-query"
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  GitCompareArrows,
  Pencil,
  Percent,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react"
import { useContract, useDeleteContract } from "@/hooks/use-contracts"
import { getContractPeriods } from "@/lib/actions/contract-periods"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { ContractDetailOverview } from "@/components/contracts/contract-detail-overview"
import { ContractTermsDisplay } from "@/components/contracts/contract-terms-display"
import { ContractDocumentsList } from "@/components/contracts/contract-documents-list"
import { ContractTransactions } from "@/components/contracts/contract-transactions"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { AmendmentExtractor } from "@/components/contracts/amendment-extractor"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"

interface ContractDetailClientProps {
  contractId: string
}

export function ContractDetailClient({
  contractId,
}: ContractDetailClientProps) {
  const router = useRouter()
  const { data: contract, isLoading } = useContract(contractId)
  const { data: periods } = useQuery({
    queryKey: ["contract-periods", contractId],
    queryFn: () => getContractPeriods(contractId),
    enabled: !!contractId,
  })
  const deleteMutation = useDeleteContract()
  const [showDelete, setShowDelete] = useState(false)
  const [showAmendment, setShowAmendment] = useState(false)

  const stats = useMemo(() => {
    if (!contract) return null

    // Sum spend from periods, but also check rebates array for earned/collected
    const periodSpend = (periods ?? []).reduce(
      (sum, p) => sum + Number(p.totalSpend),
      0,
    )
    const periodRebateEarned = (periods ?? []).reduce(
      (sum, p) => sum + Number(p.rebateEarned),
      0,
    )
    const periodRebateCollected = (periods ?? []).reduce(
      (sum, p) => sum + Number(p.rebateCollected),
      0,
    )

    // Also sum from the Rebate model if available
    const rebateModelEarned = (contract.rebates ?? []).reduce(
      (sum: number, r: { rebateEarned?: unknown }) => sum + Number(r.rebateEarned ?? 0),
      0,
    )
    const rebateModelCollected = (contract.rebates ?? []).reduce(
      (sum: number, r: { rebateCollected?: unknown }) => sum + Number(r.rebateCollected ?? 0),
      0,
    )

    // Use whichever source has data
    const totalSpend = periodSpend
    const rebateEarned = Math.max(periodRebateEarned, rebateModelEarned)
    const rebateCollected = Math.max(periodRebateCollected, rebateModelCollected)

    const totalValue = Number(contract.totalValue)
    const commitmentPct =
      totalValue > 0 ? Math.round((totalSpend / totalValue) * 100) : 0

    const now = new Date()
    const expDate = new Date(contract.expirationDate)
    const daysUntilExpiration = Math.max(
      0,
      Math.ceil(
        (expDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      ),
    )

    return {
      totalValue,
      totalSpend,
      commitmentPct,
      rebateEarned,
      rebateCollected,
      daysUntilExpiration,
      expirationDate: contract.expirationDate,
    }
  }, [contract, periods])

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] w-full" />
          ))}
        </div>
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (!contract) return null

  return (
    <div className="space-y-6">
      {/* ── Header ────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div className="flex items-start gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="mt-0.5"
            onClick={() => router.push("/dashboard/contracts")}
          >
            <ArrowLeft className="size-4" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              {contract.name}
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {contract.vendor.name}
              {contract.contractNumber && ` \u00b7 ${contract.contractNumber}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/dashboard/contracts/${contractId}/score`)
            }
          >
            <Sparkles className="size-4" /> AI Score
          </Button>
          <Button
            variant="outline"
            onClick={() => setShowAmendment(true)}
          >
            <GitCompareArrows className="size-4" /> Extract Amendment
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/dashboard/contracts/${contractId}/edit`)
            }
          >
            <Pencil className="size-4" /> Edit
          </Button>
          <Button
            variant="destructive"
            onClick={() => setShowDelete(true)}
          >
            <Trash2 className="size-4" /> Delete
          </Button>
        </div>
      </div>

      {/* ── Stat Cards ────────────────────────────────────────── */}
      {stats && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <DollarSign className="size-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Contract Value</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(stats.totalValue)}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <TrendingUp className="size-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Current Spend</p>
                <p className="text-2xl font-bold">
                  {formatCurrency(stats.totalSpend)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {stats.commitmentPct}% of commitment
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Percent className="size-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">Rebates Earned</p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(stats.rebateEarned)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(stats.rebateCollected)} collected
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="flex items-center gap-4 pt-6">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                <Calendar className="size-5" />
              </div>
              <div>
                <p className="text-sm text-muted-foreground">
                  Days Until Expiration
                </p>
                <p className="text-2xl font-bold">
                  {stats.daysUntilExpiration}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(stats.expirationDate)}
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Tabs ──────────────────────────────────────────────── */}
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="transactions">Transactions</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="rebates">Rebates &amp; Tiers</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ─────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Contract Details Card */}
            <Card>
              <CardHeader>
                <CardTitle>Contract Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <DetailRow
                  label="Contract Type"
                  value={
                    <span className="capitalize">
                      {contract.contractType.replace(/_/g, " ")}
                    </span>
                  }
                />
                {contract.productCategory && (
                  <DetailRow
                    label="Product Category"
                    value={contract.productCategory.name}
                  />
                )}
                <DetailRow
                  label="Effective Date"
                  value={formatDate(contract.effectiveDate)}
                />
                <DetailRow
                  label="Expiration Date"
                  value={formatDate(contract.expirationDate)}
                />
                <DetailRow label="Vendor" value={contract.vendor.name} />
                {contract.description && (
                  <div className="pt-2">
                    <p className="text-sm font-medium text-muted-foreground">
                      Description
                    </p>
                    <p className="mt-1 text-sm">{contract.description}</p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Commitment Progress Card */}
            <Card>
              <CardHeader>
                <CardTitle>Commitment Progress</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                {stats && (
                  <>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Spend Progress
                        </span>
                        <span className="font-medium">
                          {stats.commitmentPct}%
                        </span>
                      </div>
                      <Progress
                        value={Math.min(stats.commitmentPct, 100)}
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(stats.totalSpend)} of{" "}
                        {formatCurrency(stats.totalValue)} commitment
                      </p>
                    </div>

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">
                          Rebate Collection
                        </span>
                        <span className="font-medium">
                          {stats.rebateEarned > 0
                            ? Math.round(
                                (stats.rebateCollected / stats.rebateEarned) *
                                  100,
                              )
                            : 0}
                          %
                        </span>
                      </div>
                      <Progress
                        value={
                          stats.rebateEarned > 0
                            ? Math.min(
                                Math.round(
                                  (stats.rebateCollected /
                                    stats.rebateEarned) *
                                    100,
                                ),
                                100,
                              )
                            : 0
                        }
                        className="h-2"
                      />
                      <p className="text-xs text-muted-foreground">
                        {formatCurrency(stats.rebateCollected)} of{" "}
                        {formatCurrency(stats.rebateEarned)} earned
                      </p>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Transactions Tab ─────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-6">
          <ContractTransactions contractId={contractId} />
        </TabsContent>

        {/* ── Performance Tab ──────────────────────────────────── */}
        <TabsContent value="performance" className="mt-6">
          <PerformanceSummary
            periods={periods ?? []}
            totalValue={stats?.totalValue ?? 0}
          />
        </TabsContent>

        {/* ── Rebates & Tiers Tab ──────────────────────────────── */}
        <TabsContent value="rebates" className="mt-6">
          <ContractTermsDisplay terms={contract.terms} />
        </TabsContent>

        {/* ── Documents Tab ────────────────────────────────────── */}
        <TabsContent value="documents" className="mt-6">
          <ContractDocumentsList documents={contract.documents} />
        </TabsContent>
      </Tabs>

      {/* ── Dialogs ───────────────────────────────────────────── */}
      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="Delete Contract"
        description={`Are you sure you want to delete "${contract.name}"? This action cannot be undone.`}
        onConfirm={async () => {
          await deleteMutation.mutateAsync(contractId)
          router.push("/dashboard/contracts")
        }}
        isLoading={deleteMutation.isPending}
        variant="destructive"
      />

      <AmendmentExtractor
        contractId={contractId}
        open={showAmendment}
        onOpenChange={setShowAmendment}
        onApplied={() => {
          window.location.reload()
        }}
      />
    </div>
  )
}

/* ── Helper Components ──────────────────────────────────────────── */

function DetailRow({
  label,
  value,
}: {
  label: string
  value: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  )
}

type PeriodData = Awaited<ReturnType<typeof getContractPeriods>>[number]

function PerformanceSummary({
  periods,
  totalValue,
}: {
  periods: PeriodData[]
  totalValue: number
}) {
  if (periods.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No performance data available yet. Add contract periods to see
          performance metrics.
        </CardContent>
      </Card>
    )
  }

  const sorted = [...periods].sort(
    (a, b) =>
      new Date(a.periodStart).getTime() - new Date(b.periodStart).getTime(),
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Spend Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Spend by Period</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sorted.map((p) => {
              const spend = Number(p.totalSpend)
              const pct =
                totalValue > 0
                  ? Math.min(Math.round((spend / totalValue) * 100), 100)
                  : 0
              return (
                <div key={p.id} className="space-y-1">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {formatDate(p.periodStart)} &ndash;{" "}
                      {formatDate(p.periodEnd)}
                    </span>
                    <span className="font-medium">
                      {formatCurrency(spend)}
                    </span>
                  </div>
                  <Progress value={pct} className="h-1.5" />
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      {/* Tier Achievement */}
      <Card>
        <CardHeader>
          <CardTitle>Tier Achievement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sorted.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between rounded-md border px-3 py-2"
              >
                <span className="text-sm text-muted-foreground">
                  {formatDate(p.periodStart)} &ndash;{" "}
                  {formatDate(p.periodEnd)}
                </span>
                <span className="text-sm font-medium">
                  {p.tierAchieved != null ? `Tier ${p.tierAchieved}` : "N/A"}
                </span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
