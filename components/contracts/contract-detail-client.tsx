"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  Download,
  Pencil,
  Percent,
  Plus,
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
import { DocumentUpload } from "@/components/contracts/document-upload"
import { createContractDocument } from "@/lib/actions/contracts/documents"
import { queryKeys } from "@/lib/query-keys"
import { ContractTransactions } from "@/components/contracts/contract-transactions"
import { ContractPricingTab } from "@/components/contracts/contract-pricing-tab"
import { ContractInsightsCards } from "@/components/contracts/contract-insights-cards"
import { ContractAccrualTimeline } from "@/components/contracts/contract-accrual-timeline"
import { ContractPerformanceCharts } from "@/components/contracts/contract-performance-charts"
import { ContractTieInCard } from "@/components/contracts/contract-tie-in-card"
import { OffContractSpendCard } from "@/components/contracts/off-contract-spend-card"
import { ContractChangeProposalsCard } from "@/components/contracts/contract-change-proposals-card"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { AmendmentExtractor } from "@/components/contracts/amendment-extractor"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
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
  const queryClient = useQueryClient()
  const [periodId, setPeriodId] = useState<string | undefined>(undefined)
  const { data: contract, isLoading } = useContract(contractId, periodId)
  const { data: periods } = useQuery({
    queryKey: ["contract-periods", contractId],
    queryFn: () => getContractPeriods(contractId),
    enabled: !!contractId,
  })
  const deleteMutation = useDeleteContract()
  const [showDelete, setShowDelete] = useState(false)
  const [showAmendment, setShowAmendment] = useState(false)
  const [docDialogOpen, setDocDialogOpen] = useState(false)

  async function handleDocUploaded(doc: {
    name: string
    type: string
    url: string
  }) {
    try {
      await createContractDocument({
        contractId,
        name: doc.name,
        url: doc.url,
        type: doc.type,
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      })
      toast.success("Document uploaded")
      setDocDialogOpen(false)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload document",
      )
    }
  }

  const stats = useMemo(() => {
    if (!contract) return null

    // Server already applies the correct temporal filters:
    //   rebateEarned    — sums Rebate rows where payPeriodEnd <= today
    //   rebateCollected — sums rows where collectionDate != null
    //   currentSpend    — COGRecord aggregate for facility+vendor
    // (See lib/actions/contracts.ts::getContract.) Trust the server values.
    const rebateEarned = Number(contract.rebateEarned ?? 0)
    const rebateCollected = Number(contract.rebateCollected ?? 0)
    const totalSpend = Number(contract.currentSpend ?? 0)

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
  }, [contract])

  // Build a deduped, ordered list of product categories: primary first,
  // then remaining join-table categories alphabetically. Dedupe by id.
  const productCategories = useMemo<Array<{ id: string; name: string }>>(() => {
    if (!contract) return []

    const primary = contract.productCategory ?? null
    const joined = (contract.contractCategories ?? [])
      .map((cc) => cc.productCategory)
      .filter(
        (pc): pc is { id: string; name: string } =>
          pc !== null && pc !== undefined,
      )

    const seen = new Set<string>()
    const ordered: Array<{ id: string; name: string }> = []

    if (primary) {
      seen.add(primary.id)
      ordered.push({ id: primary.id, name: primary.name })
    }

    const rest = joined
      .filter((pc) => !seen.has(pc.id))
      .sort((a, b) => a.name.localeCompare(b.name))

    for (const pc of rest) {
      if (seen.has(pc.id)) continue
      seen.add(pc.id)
      ordered.push({ id: pc.id, name: pc.name })
    }

    return ordered
  }, [contract])

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
            <Sparkles className="mr-2 size-4" /> AI Score
          </Button>
          <Button
            variant="outline"
            onClick={() =>
              router.push(`/dashboard/contracts/${contractId}/edit`)
            }
          >
            <Pencil className="mr-2 size-4" /> Edit Contract
          </Button>
          <Button variant="outline" onClick={() => setShowAmendment(true)}>
            <Plus className="mr-2 size-4" /> Add Amendment
          </Button>
          <Button>
            <Download className="mr-2 size-4" /> Export
          </Button>
          <Button
            variant="destructive"
            size="icon"
            onClick={() => setShowDelete(true)}
            aria-label="Delete contract"
          >
            <Trash2 className="size-4" />
          </Button>
        </div>
      </div>

      {/* ── Period selector (only when ≥2 periods) ───────────── */}
      {contract.periods && contract.periods.length >= 2 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Period:</span>
          <Select
            value={periodId ?? "__all__"}
            onValueChange={(v) =>
              setPeriodId(v === "__all__" ? undefined : v)
            }
          >
            <SelectTrigger className="w-[280px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All periods</SelectItem>
              {contract.periods.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {formatDate(p.periodStart)} – {formatDate(p.periodEnd)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

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
          <TabsTrigger value="pricing">Pricing</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ─────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Pending vendor-submitted change proposals — hidden when none. */}
          <ContractChangeProposalsCard contractId={contractId} />
          {/* Tie-in bundle card — renders only when this contract is a bundle primary */}
          <ContractTieInCard contractId={contractId} />
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
                {productCategories.length > 0 && (
                  <DetailRow
                    label={
                      productCategories.length > 1
                        ? "Product Categories"
                        : "Product Category"
                    }
                    value={
                      productCategories.length > 3 ? (
                        <div className="flex flex-wrap justify-end gap-1">
                          {productCategories.map((pc) => (
                            <Badge key={pc.id} variant="secondary">
                              {pc.name}
                            </Badge>
                          ))}
                        </div>
                      ) : (
                        productCategories.map((pc) => pc.name).join(", ")
                      )
                    }
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

          {contract.contractType === "tie_in" && contract.terms[0] && (
            <Card>
              <CardHeader>
                <CardTitle>Tie-In Capital</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="grid gap-4 sm:grid-cols-3 text-sm">
                  <div>
                    <p className="text-muted-foreground">Capital Cost</p>
                    <p className="font-medium">
                      {contract.terms[0].capitalCost != null
                        ? formatCurrency(Number(contract.terms[0].capitalCost))
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Interest Rate</p>
                    <p className="font-medium">
                      {contract.terms[0].interestRate != null
                        ? `${(Number(contract.terms[0].interestRate) * 100).toFixed(2)}%`
                        : "—"}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Term</p>
                    <p className="font-medium">
                      {contract.terms[0].termMonths != null
                        ? `${contract.terms[0].termMonths} months`
                        : "—"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Compliance Status Card */}
          {contract.complianceRate != null && (
            <Card>
              <CardHeader>
                <CardTitle>Compliance</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold">
                    {Number(contract.complianceRate).toFixed(0)}%
                  </div>
                  <Badge
                    className={
                      Number(contract.complianceRate) >= 90
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : Number(contract.complianceRate) >= 75
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/15 text-red-700 dark:text-red-400"
                    }
                  >
                    {Number(contract.complianceRate) >= 90
                      ? "On Track"
                      : Number(contract.complianceRate) >= 75
                        ? "Needs Attention"
                        : "At Risk"}
                  </Badge>
                </div>
                <Progress value={Number(contract.complianceRate)} />
                <p className="text-xs text-muted-foreground">
                  % of vendor purchases routed through this contract.
                </p>
              </CardContent>
            </Card>
          )}

          {contract.currentMarketShare != null && contract.marketShareCommitment != null && Number(contract.marketShareCommitment) > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Market Share Commitment</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold">
                    {Number(contract.currentMarketShare).toFixed(0)}%
                  </div>
                  <span className="text-sm text-muted-foreground">
                    of {Number(contract.marketShareCommitment).toFixed(0)}% commitment
                  </span>
                  <Badge
                    className={
                      (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100 >= 80
                        ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                        : (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100 >= 60
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-red-500/15 text-red-700 dark:text-red-400"
                    }
                  >
                    {Math.round(
                      (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100,
                    )}% met
                  </Badge>
                </div>
                <Progress
                  value={Math.min(
                    100,
                    (Number(contract.currentMarketShare) / Number(contract.marketShareCommitment)) * 100,
                  )}
                />
                <p className="text-xs text-muted-foreground">
                  Current market share vs the commitment target on this contract.
                </p>
              </CardContent>
            </Card>
          )}

          <OffContractSpendCard contractId={contractId} />
        </TabsContent>

        {/* ── Transactions Tab ─────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-6">
          <ContractTransactions contractId={contractId} />
        </TabsContent>

        {/* ── Performance Tab ──────────────────────────────────── */}
        <TabsContent value="performance" className="mt-6 space-y-6">
          <ContractPerformanceCharts contractId={contractId} />
          <ContractInsightsCards contractId={contractId} />
          <ContractAccrualTimeline contractId={contractId} />
          <PerformanceSummary
            periods={periods ?? []}
            totalValue={stats?.totalValue ?? 0}
          />
        </TabsContent>

        {/* ── Rebates & Tiers Tab ──────────────────────────────── */}
        <TabsContent value="rebates" className="mt-6">
          <ContractTermsDisplay terms={contract.terms} currentSpend={stats?.totalSpend} />
        </TabsContent>

        {/* ── Pricing Tab ──────────────────────────────────────── */}
        <TabsContent value="pricing" className="mt-6">
          <ContractPricingTab
            contractId={contractId}
            vendorId={contract.vendorId}
          />
        </TabsContent>

        {/* ── Documents Tab ────────────────────────────────────── */}
        <TabsContent value="documents" className="mt-6">
          <ContractDocumentsList
            documents={contract.documents}
            contractId={contractId}
            onUpload={() => setDocDialogOpen(true)}
          />
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

      <DocumentUpload
        contractId={contractId}
        open={docDialogOpen}
        onOpenChange={setDocDialogOpen}
        onUploaded={handleDocUploaded}
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
