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
  HelpCircle,
  Pencil,
  Percent,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useContract, useDeleteContract } from "@/hooks/use-contracts"
import type { getContract } from "@/lib/actions/contracts"
import { getContractPeriods } from "@/lib/actions/contract-periods"
import { formatCurrency, formatCalendarDate, formatPercent } from "@/lib/formatting"
import { calculateTierProgress } from "@/lib/contracts/tier-progress"
import { computeProjectedRebate } from "@/lib/contracts/projected-rebate"
import { formatTierRebateLabel } from "@/lib/contracts/tier-rebate-label"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"
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
// Performance-tab analytics cards are lazy-loaded — they pull in
// recharts (RadarChart, ComposedChart, AreaChart) which is the
// heaviest single dep on this page. Dynamic-import keeps them out
// of the initial bundle when users land on Overview / Transactions.
import dynamic from "next/dynamic"
const RebateForecastCard = dynamic(
  () =>
    import("@/components/contracts/analytics/rebate-forecast-card").then(
      (m) => m.RebateForecastCard,
    ),
  { ssr: false },
)
const TieInComplianceCard = dynamic(
  () =>
    import("@/components/contracts/analytics/tie-in-compliance-card").then(
      (m) => m.TieInComplianceCard,
    ),
  { ssr: false },
)
const ServiceSlaCard = dynamic(
  () =>
    import("@/components/contracts/analytics/service-sla-card").then(
      (m) => m.ServiceSlaCard,
    ),
  { ssr: false },
)
import { ContractTieInCard } from "@/components/contracts/contract-tie-in-card"
import { ContractBundleMembershipsCard } from "@/components/contracts/contract-bundle-memberships-card"
import { ContractPerformanceCard } from "@/components/contracts/contract-performance-card"
import { ContractCapitalProjectionCard } from "@/components/contracts/contract-capital-projection-card"
import { ContractAmortizationCard } from "@/components/contracts/contract-amortization-card"
import { TieInRebateSplit } from "@/components/contracts/tie-in-rebate-split"
import { OffContractSpendCard } from "@/components/contracts/off-contract-spend-card"
import { CategoryMarketShareCard } from "@/components/contracts/category-market-share-card"
import { ContractChangeProposalsCard } from "@/components/contracts/contract-change-proposals-card"
import { OverviewTab } from "@/components/contracts/tabs/overview-tab"
import { PerformanceSummary } from "@/components/contracts/tabs/_performance-summary"
import { ConfirmDialog } from "@/components/shared/forms/confirm-dialog"
import { AmendmentExtractor } from "@/components/contracts/amendment-extractor"
import { RenewalBriefDialog } from "@/components/contracts/renewal-brief-dialog"
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
  // W2.A.5 — server-rendered contract payload threaded in from the
  // server component so the first client render already has the full
  // header-card numbers (currentSpend, rebateEarnedYTD, …). Prevents
  // the "$0 flash" on initial page load.
  initialContract?: Awaited<ReturnType<typeof getContract>>
  /**
   * 2026-04-26 perf pass — server-prefetched Performance-tab bundle
   * (composite score, renewal risk, rebate forecast, tie-in
   * compliance). Threaded into the analytics cards as `initialData`
   * so the Performance tab paints from React Query cache without a
   * client-side waterfall.
   */
  initialPerformanceBundle?: Awaited<
    ReturnType<
      typeof import("@/lib/actions/analytics/contract-performance-bundle").getContractPerformanceBundle
    >
  >
}

export function ContractDetailClient({
  contractId,
  initialContract,
  initialPerformanceBundle,
}: ContractDetailClientProps) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const [periodId, setPeriodId] = useState<string | undefined>(undefined)
  const { data: contract, isLoading } = useContract(contractId, periodId, {
    initialData: initialContract,
  })
  // Keyed `contractPeriods` (camelCase) to match the invalidation key
  // used by every other call site (edit-contract-client, contract-
  // transactions, contract-terms-page-client). Prior `"contract-periods"`
  // kebab-case key meant Transactions-tab writes never invalidated this
  // view, so the detail page could show stale periods until a full
  // refetch. Spotted while chasing Bug 12.
  const { data: periods } = useQuery({
    queryKey: ["contractPeriods", contractId],
    queryFn: () => getContractPeriods(contractId),
    enabled: !!contractId,
  })
  const deleteMutation = useDeleteContract()
  const [showDelete, setShowDelete] = useState(false)
  const [showAmendment, setShowAmendment] = useState(false)
  const [showRenewalBrief, setShowRenewalBrief] = useState(false)
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
    //   rebateEarned    — sums Rebate rows where payPeriodEnd <= today (lifetime)
    //   rebateEarnedYTD — same as rebateEarned but only counts closed periods
    //                     whose payPeriodEnd is within the current calendar year
    //                     (Charles R5.27: the header card now shows YTD so the
    //                      "Rebates Earned (YTD)" label disambiguates from the
    //                      "Total Rebates (Lifetime)" card on the Transactions
    //                      tab). Lifetime value is still used below for the
    //                      collection-ratio progress widget.
    //   rebateCollected — sums rows where collectionDate != null
    //   currentSpend    — ContractPeriod.totalSpend rollup for this contract,
    //                     falling back to COGRecord.extendedPrice (contractId)
    //                     when no periods are recorded yet
    // (See lib/actions/contracts.ts::getContract.) Trust the server values.
    const rebateEarned = Number(contract.rebateEarned ?? 0)
    const rebateEarnedYTD = Number(
      (contract as { rebateEarnedYTD?: number | string | null })
        .rebateEarnedYTD ?? 0,
    )
    const rebateCollected = Number(contract.rebateCollected ?? 0)
    const totalSpend = Number(contract.currentSpend ?? 0)

    const totalValue = Number(contract.totalValue)

    // Tier-progress view: the Commitment Progress card's "Spend Progress" bar
    // should measure how close current spend is to unlocking the next rebate
    // tier, not how much of the paper contract-value has been burned. Contract
    // Value remains the denominator for the header "Current Spend / commitment"
    // stat and the Contract Details card. When the contract has no tiered
    // rebate structure (e.g. pricing_only, or a draft usage/tie-in contract
    // that hasn't had terms wired up yet), we fall back to the legacy
    // totalSpend / totalValue ratio purely so the bar still renders — the UI
    // branch above suppresses tier copy in that state.
    const firstTermWithTiers = contract.terms?.find((t) => t.tiers.length > 0)
    const tiersForEngine: TierLike[] | null = firstTermWithTiers
      ? firstTermWithTiers.tiers.map((t) => ({
          tierNumber: t.tierNumber,
          tierName: t.tierName ?? null,
          spendMin: Number(t.spendMin),
          spendMax: t.spendMax != null ? Number(t.spendMax) : null,
          rebateValue: Number(t.rebateValue),
        }))
      : null
    const tierMethod: RebateMethodName =
      (firstTermWithTiers?.rebateMethod as RebateMethodName | undefined) ??
      "cumulative"
    const tierProgress =
      tiersForEngine && tiersForEngine.length > 0
        ? calculateTierProgress(totalSpend, tiersForEngine, tierMethod)
        : null
    const currentTierSourceTier = firstTermWithTiers && tierProgress?.currentTier
      ? firstTermWithTiers.tiers.find(
          (t) => t.tierNumber === tierProgress.currentTier!.tierNumber,
        ) ?? null
      : null
    const atTopTier = !!tierProgress && tierProgress.nextTier === null
    // commitmentPct — header stat card's "X% of commitment" caption stays on
    // the legacy spend-of-contract-value math. The Commitment Progress card
    // below uses tierProgress.progressPercent via the dedicated UI branch
    // instead (so the bar denominator is the next-tier threshold, not the
    // paper contract value — Charles W1.H).
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
      rebateEarnedYTD,
      rebateCollected,
      daysUntilExpiration,
      expirationDate: contract.expirationDate,
      tierProgress,
      currentTierSourceTier,
      atTopTier,
      hasTiers: !!tierProgress,
      // Charles iMessage 2026-04-20 N14: "Rebate earned YTD does not
      // make sense a lot because many rebates are earned on the last
      // day of the year — it should be the projected rebate there.
      // Should be the rebate they are trending toward based on historic
      // spend." Uses trailing-12-month spend × current tier rate as the
      // year-end projection. CLAUDE.md projection-vs-ledger rule: this
      // number is labeled "Projected" so it can't be mistaken for the
      // actual ledger YTD value shown above it.
      projectedYearEnd:
        firstTermWithTiers && tiersForEngine && tiersForEngine.length > 0
          ? computeProjectedRebate({
              rolling12Spend: totalSpend,
              rebateEarnedYTD,
              tiers: tiersForEngine.map((t) => ({
                ...t,
                rebateValue: (() => {
                  const src = firstTermWithTiers.tiers.find(
                    (s) => s.tierNumber === t.tierNumber,
                  )
                  const v = Number(t.rebateValue)
                  return src?.rebateType === "percent_of_spend"
                    ? toDisplayRebateValue("percent_of_spend", v)
                    : v
                })(),
              })),
              method: tierMethod,
            })
          : null,
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
              router.push(`/dashboard/contracts/${contractId}/edit`)
            }
          >
            <Pencil className="mr-2 size-4" /> Edit Contract
          </Button>
          <Button variant="outline" onClick={() => setShowAmendment(true)}>
            <Plus className="mr-2 size-4" /> Add Amendment
          </Button>
          {/*
           * Renewal Brief (Tier 4 AI) — only surfaced when the contract is
           * within ~180 days of expiration, since that's when a negotiation
           * primer is actually useful. The button is lazy-opens the dialog;
           * the Claude call kicks off inside the modal itself.
           */}
          {stats && stats.daysUntilExpiration <= 180 && (
            <Button
              variant="outline"
              onClick={() => setShowRenewalBrief(true)}
            >
              <Sparkles className="mr-2 size-4" /> Generate Renewal Brief
            </Button>
          )}
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
                  {formatCalendarDate(p.periodStart)} – {formatCalendarDate(p.periodEnd)}
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
                <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  Contract Value
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center">
                          <HelpCircle
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label="Contract Value help"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[320px] p-3 text-xs">
                        {/*
                         * Charles 2026-04-24 (Bug 6): the prior copy called
                         * this "committed spend" which over-claims — for
                         * many contracts (rebate-only, grouped, pricing-only)
                         * there's no hard dollar commitment, just an expected
                         * figure from the agreement. Neutralize the wording.
                         */}
                        <p>
                          Contract Value is the total dollar figure captured
                          from the agreement — typically the expected or
                          committed spend over the full term. It does not
                          update as spend accrues; Current Spend below shows
                          actual purchase activity against this reference.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
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
                <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  Current Spend (Last 12 Months)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center">
                          <HelpCircle
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label="Current Spend help"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[320px] p-3 text-xs">
                        <p>
                          Total spend on this contract&apos;s vendor over the
                          trailing 12 calendar months. Includes all purchase
                          activity whether or not a contract pricing file is
                          linked.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
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
                <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  Rebates Earned
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center">
                          <HelpCircle
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label="Rebates Earned help"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[320px] p-3 text-xs">
                        <p>
                          <span className="font-semibold">Lifetime earned:</span>{" "}
                          sums every closed rebate period
                          (payPeriodEnd&nbsp;≤&nbsp;today) on this contract.
                          The YTD figure below the total covers Jan&nbsp;1 of
                          this year through today.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(stats.rebateEarned)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(stats.rebateEarnedYTD)} YTD · {formatCurrency(stats.rebateCollected)} collected
                </p>
                {stats.projectedYearEnd != null &&
                  stats.projectedYearEnd.projectedFullYear > 0 && (
                    <p className="mt-1 inline-flex items-start gap-1 text-xs text-muted-foreground">
                      <span>
                        <span className="font-medium text-foreground">
                          {formatCurrency(
                            stats.projectedYearEnd.projectedFullYear,
                          )}
                        </span>{" "}
                        projected at period end if current pace holds
                      </span>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex cursor-help items-center">
                              <HelpCircle
                                className="h-3 w-3 text-muted-foreground"
                                aria-label="Projection details"
                              />
                            </span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-[360px] p-3 text-xs">
                            <p>
                              <span className="font-semibold">
                                Projection, not earned:
                              </span>{" "}
                              this is what the rebate would be <em>if</em>{" "}
                              the trailing-12-month spend pace continues
                              and <em>if</em> all end-of-period thresholds
                              are met at period close. Rebates are only
                              earned when a period closes (see &quot;YTD
                              only&quot; above).
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </p>
                  )}
                {/* Charles audit pass-4 round-3: include "capital"
                    contracts with sibling-usage rebates retiring
                    their balance — they have a real schedule too. */}
                {(contract.contractType === "tie_in" ||
                  contract.contractType === "capital") && (
                  <TieInRebateSplit
                    contractId={contractId}
                    rebateEarned={stats.rebateEarned}
                  />
                )}
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
                  {formatCalendarDate(stats.expirationDate)}
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
        <OverviewTab
          contract={contract}
          contractId={contractId}
          stats={stats}
          productCategories={productCategories}
        />

        {/* ── Transactions Tab ─────────────────────────────────── */}
        <TabsContent value="transactions" className="mt-6">
          <ContractTransactions contractId={contractId} contractType={contract.contractType} />
        </TabsContent>

        {/* ── Performance Tab ──────────────────────────────────── */}
        <TabsContent value="performance" className="mt-6 space-y-6">
          {contract.contractType === "tie_in" ? (
            <TieInComplianceCard
              contractId={contractId}
              initialData={initialPerformanceBundle?.tieIn ?? undefined}
            />
          ) : null}
          {contract.contractType === "service" ? (
            <ServiceSlaCard contractId={contractId} />
          ) : null}
          <RebateForecastCard
            contractId={contractId}
            initialData={initialPerformanceBundle?.forecast}
          />
          <ContractPerformanceCharts contractId={contractId} />
          <ContractInsightsCards contractId={contractId} />
          <ContractAccrualTimeline contractId={contractId} />
          <PerformanceSummary
            periods={periods ?? []}
            totalValue={stats?.totalValue ?? 0}
            contractTiers={
              // Charles 2026-04-25: feed the contract's first-term tier
              // ladder into the Tier Achievement panel so it computes
              // tier from period.totalSpend (the same way the timeline
              // does) instead of trusting the stale ContractPeriod
              // .tierAchieved rollup. Without this the panel can show
              // "Tier 3" while the timeline shows the contract only
              // reached Tier 1 in the same month.
              contract.terms
                ?.find((t) => t.tiers.length > 0)
                ?.tiers.map((t) => ({
                  tierNumber: t.tierNumber,
                  spendMin: Number(t.spendMin),
                })) ?? []
            }
          />
        </TabsContent>

        {/* ── Rebates & Tiers Tab ──────────────────────────────── */}
        <TabsContent value="rebates" className="mt-6">
          <ContractTermsDisplay
            terms={contract.terms}
            currentSpend={stats?.totalSpend}
            termScopedSpend={
              (contract as { termScopedSpend?: Record<string, number> })
                .termScopedSpend
            }
          />
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

      <RenewalBriefDialog
        contractId={contractId}
        contractName={contract.name}
        open={showRenewalBrief}
        onOpenChange={setShowRenewalBrief}
      />
    </div>
  )
}

