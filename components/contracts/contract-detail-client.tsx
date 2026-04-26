"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
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
import { formatCurrency, formatDate, formatCalendarDate, formatPercent } from "@/lib/formatting"
import { calculateTierProgress } from "@/lib/contracts/tier-progress"
import { computeProjectedRebate } from "@/lib/contracts/projected-rebate"
import { formatTierRebateLabel } from "@/lib/contracts/tier-rebate-label"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import type { TierLike, RebateMethodName } from "@/lib/rebates/calculate"
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
// Performance-tab analytics cards are lazy-loaded — they pull in
// recharts (RadarChart, ComposedChart, AreaChart) which is the
// heaviest single dep on this page. Dynamic-import keeps them out
// of the initial bundle when users land on Overview / Transactions.
import dynamic from "next/dynamic"
const ContractScoreCard = dynamic(
  () =>
    import("@/components/contracts/analytics/contract-score-card").then(
      (m) => m.ContractScoreCard,
    ),
  { ssr: false },
)
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
                  Rebates Earned (YTD)
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="inline-flex cursor-help items-center">
                          <HelpCircle
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-label="Rebates Earned (YTD) help"
                          />
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-[320px] p-3 text-xs">
                        <p>
                          <span className="font-semibold">YTD only:</span>{" "}
                          sums closed rebate periods whose end date falls
                          between Jan&nbsp;1 of this year and today.
                          &quot;Closed&quot; means the period&apos;s end date
                          has passed. The Transactions tab below shows the
                          full lifetime ledger, so individual rows there can
                          be larger than this YTD total.
                        </p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatCurrency(stats.rebateEarnedYTD)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatCurrency(stats.rebateCollected)} collected (lifetime)
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
        <TabsContent value="overview" className="mt-6 space-y-6">
          {/* Pending vendor-submitted change proposals — hidden when none. */}
          <ContractChangeProposalsCard contractId={contractId} />
          {/* Tie-in bundle card — renders only when this contract is a bundle primary */}
          <ContractTieInCard contractId={contractId} />
          {/* v0 bundled-multi-product tie-in memberships card. */}
          <ContractBundleMembershipsCard contractId={contractId} />
          {/* v0 §9 performance card — rebate utilization + renewal risk. */}
          <ContractPerformanceCard contractId={contractId} />
          {/* Wave A: tie-in amortization + capital summary.
              Shows only for tie-in contracts that either link to a capital
              contract or carry capital fields on a term themselves. */}
          {contract.contractType === "tie_in" && (
            // Charles audit suggestion #4 (v0-port): always render — the
            // card itself shows an empty state when no capital line
            // items exist (the legacy capitalCost null-check was here).
            <ContractAmortizationCard contractId={contractId} />
          )}
          {/* Wave C — shortfall handling banner + run-rate projection
              (only for tie-in contracts). */}
          {contract.contractType === "tie_in" &&
            (() => {
              const tieInTerm = contract.terms.find(
                (t) => t.shortfallHandling != null,
              )
              const handling = tieInTerm?.shortfallHandling ?? "carry_forward"
              const billImmediately = handling === "bill_immediately"
              return (
                <div
                  className={
                    "rounded-md border p-3 text-sm " +
                    (billImmediately
                      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200"
                      : "border-muted bg-muted/30 text-muted-foreground")
                  }
                >
                  <span className="font-medium">
                    {billImmediately ? "⚠ Shortfall handling: " : "ℹ Shortfall handling: "}
                  </span>
                  {billImmediately
                    ? "Bill immediately — vendor invoices the shortfall at period close."
                    : "Carry forward — the shortfall applies to the next period's commitment."}
                </div>
              )
            })()}
          {contract.contractType === "tie_in" && (
            <ContractCapitalProjectionCard contractId={contractId} />
          )}
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
                  value={formatCalendarDate(contract.effectiveDate)}
                />
                <DetailRow
                  label="Expiration Date"
                  value={formatCalendarDate(contract.expirationDate)}
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
                    {stats.hasTiers &&
                      stats.tierProgress &&
                      stats.tierProgress.currentTier && (
                        <div className="space-y-2">
                          {(() => {
                            const tp = stats.tierProgress!
                            const currentTier = tp.currentTier!
                            const nextTier = tp.nextTier
                            const atTop = stats.atTopTier
                            const currentLabel =
                              currentTier.tierName ??
                              `Tier ${currentTier.tierNumber}`
                            const nextLabel = nextTier
                              ? nextTier.tierName ??
                                `Tier ${nextTier.tierNumber}`
                              : null
                            const rateDisplay = stats.currentTierSourceTier
                              ? formatTierRebateLabel(
                                  stats.currentTierSourceTier.rebateType,
                                  Number(
                                    stats.currentTierSourceTier.rebateValue,
                                  ),
                                )
                              : formatPercent(
                                  toDisplayRebateValue(
                                    "percent_of_spend",
                                    currentTier.rebateValue,
                                  ),
                                )
                            // Charles W1.W-B3: bar denominator is BASELINE —
                            // the first tier threshold that starts earning a
                            // rebate. Past baseline, flip to "Past baseline ·
                            // N% to next tier" and use the next-tier threshold
                            // for the secondary bar. Contract Value is still
                            // a separate metric on the header card.
                            const firstTermWithTiers = contract.terms?.find(
                              (t) => t.tiers.length > 0,
                            )
                            const sortedTiers = firstTermWithTiers
                              ? [...firstTermWithTiers.tiers].sort(
                                  (a, b) =>
                                    Number(a.spendMin) - Number(b.spendMin),
                                )
                              : []
                            const baselineSpend = sortedTiers.length
                              ? Number(sortedTiers[0].spendMin)
                              : 0
                            const pastBaseline =
                              stats.totalSpend >= baselineSpend
                            const baselinePercent = baselineSpend > 0
                              ? Math.min(
                                  100,
                                  Math.max(
                                    0,
                                    (stats.totalSpend / baselineSpend) * 100,
                                  ),
                                )
                              : 100
                            const barPct = !pastBaseline
                              ? Math.round(baselinePercent)
                              : atTop
                                ? 100
                                : Math.round(tp.progressPercent)
                            const nextThreshold = nextTier?.spendMin ?? 0
                            return (
                              <>
                                <div className="flex items-center justify-between text-sm">
                                  <span className="inline-flex items-center gap-1 text-muted-foreground">
                                    {!pastBaseline
                                      ? "Spend Progress to Baseline"
                                      : atTop
                                        ? "Past baseline · Top Tier Achieved"
                                        : `Past baseline · ${Math.round(tp.progressPercent)}% to ${nextLabel}`}
                                    <TooltipProvider>
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <span className="inline-flex cursor-help items-center">
                                            <HelpCircle
                                              className="h-3.5 w-3.5 text-muted-foreground"
                                              aria-label="Spend Progress help"
                                            />
                                          </span>
                                        </TooltipTrigger>
                                        <TooltipContent className="max-w-[320px] p-3 text-xs">
                                          <p>
                                            Progress toward the BASELINE — the
                                            first tier threshold that starts
                                            earning a rebate. Once baseline is
                                            met the bar flips to measure
                                            progress toward the next tier.
                                            Contract Value is a separate
                                            metric shown on the header card.
                                          </p>
                                        </TooltipContent>
                                      </Tooltip>
                                    </TooltipProvider>
                                  </span>
                                  <span className="font-medium">{barPct}%</span>
                                </div>
                                <Progress
                                  value={barPct}
                                  className={
                                    atTop
                                      ? "h-2 opacity-60"
                                      : "h-2"
                                  }
                                />
                                {!pastBaseline ? (
                                  <p className="text-xs text-muted-foreground">
                                    {formatCurrency(stats.totalSpend)} of{" "}
                                    {formatCurrency(baselineSpend)} to unlock
                                    the first rebate tier ({currentLabel})
                                  </p>
                                ) : atTop ? (
                                  <p className="text-xs text-muted-foreground">
                                    {currentLabel} rebate rate: {rateDisplay}.
                                    Keep spending to maximize rebate.
                                  </p>
                                ) : (
                                  <>
                                    <p className="text-xs text-muted-foreground">
                                      {formatCurrency(stats.totalSpend)} of{" "}
                                      {formatCurrency(nextThreshold)} to unlock{" "}
                                      {nextLabel}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Currently {currentLabel} · {rateDisplay}{" "}
                                      rebate
                                    </p>
                                  </>
                                )}
                                {(() => {
                                  const term = contract.terms?.[0]
                                  const mpc =
                                    term?.minimumPurchaseCommitment != null
                                      ? Number(term.minimumPurchaseCommitment)
                                      : null
                                  if (mpc == null || mpc <= 0) return null
                                  // Charles audit suggestion #4 (v0-port):
                                  // paymentCadence moved to capital line items.
                                  // Default monthly — minimum-purchase-commitment
                                  // is term-period-scoped, not cadence-scoped, so
                                  // monthly is a safe display default until the
                                  // term-level cadence accessor is wired.
                                  const cadence: "monthly" | "quarterly" | "annual" =
                                    "monthly" as "monthly" | "quarterly" | "annual"
                                  const cadenceLabel =
                                    cadence === "quarterly"
                                      ? "Quarterly"
                                      : cadence === "annual"
                                        ? "Annual"
                                        : "Monthly"
                                  const perPeriods =
                                    cadence === "quarterly"
                                      ? 4
                                      : cadence === "annual"
                                        ? 1
                                        : 12
                                  const perPeriod = mpc / perPeriods
                                  return (
                                    <p className="text-xs text-muted-foreground">
                                      Minimum {cadenceLabel} Purchase:{" "}
                                      <span className="font-medium">
                                        {formatCurrency(perPeriod)}
                                      </span>{" "}
                                      ({formatCurrency(mpc)}/yr)
                                    </p>
                                  )
                                })()}
                              </>
                            )
                          })()}
                        </div>
                      )}
                    {!stats.hasTiers &&
                      contract.contractType !== "pricing_only" && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-sm">
                            <span className="inline-flex items-center gap-1 text-muted-foreground">
                              Spend Progress
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className="inline-flex cursor-help items-center">
                                      <HelpCircle
                                        className="h-3.5 w-3.5 text-muted-foreground"
                                        aria-label="Spend Progress help"
                                      />
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[320px] p-3 text-xs">
                                    <p>
                                      This contract has no rebate tiers
                                      configured yet, so progress is shown
                                      against the Contract Value field on the
                                      agreement. Add tiers under Terms to see
                                      progress toward the next rebate
                                      threshold.
                                    </p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
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
                            {formatCurrency(stats.totalValue)} Contract Value
                          </p>
                        </div>
                      )}

                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-sm">
                        <span className="inline-flex items-center gap-1 text-muted-foreground">
                          Rebate Collection
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-flex cursor-help items-center">
                                  <HelpCircle
                                    className="h-3.5 w-3.5 text-muted-foreground"
                                    aria-label="Rebate Collection help"
                                  />
                                </span>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-[320px] p-3 text-xs">
                                <p>
                                  Rebate dollars collected divided by rebate
                                  dollars earned (lifetime). Earned sums
                                  Rebate rows whose pay period has closed;
                                  Collected sums rows with a collection date
                                  recorded. No tier-engine projections.
                                </p>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
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

          {/* Charles audit suggestion #4 (v0-port): the legacy
              contract-level Tie-In Capital card was removed — capital
              now lives in ContractCapitalLineItem rows and is rendered
              by <ContractAmortizationCard> below as a v0-style item
              table + aggregated schedule. */}

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

          {/*
           * Charles 2026-04-25: per-category market share. Computes
           * the vendor's share of facility spend in each category
           * they sell in, from real COG data (no schema migration
           * required). Renders only on contracts whose vendor has
           * COG presence.
           */}
          <CategoryMarketShareCard
            vendorId={contract.vendorId}
            contractId={contractId}
          />

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
          <ContractTransactions contractId={contractId} contractType={contract.contractType} />
        </TabsContent>

        {/* ── Performance Tab ──────────────────────────────────── */}
        <TabsContent value="performance" className="mt-6 space-y-6">
          <ContractScoreCard
            contractId={contractId}
            initialScore={initialPerformanceBundle?.score}
            initialRisk={initialPerformanceBundle?.risk}
          />
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
  contractTiers,
}: {
  periods: PeriodData[]
  totalValue: number
  /**
   * Charles 2026-04-25: tier ladder from the contract's first
   * tiered term. The Tier Achievement panel now derives each
   * period's tier from the period's `totalSpend` against this
   * ladder rather than reading `period.tierAchieved` directly,
   * which can be stale or inconsistent with the timeline.
   */
  contractTiers: Array<{ tierNumber: number; spendMin: number }>
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

  // Charles W1.W-C2: chart labels — the bare "Spend by Period" title
  // wasn't specific enough. Users asked "spend of what?". Now the
  // subtitle clarifies the scope (this contract only, last N periods),
  // the bar value shows the dollar amount alongside the "% of contract
  // value" used to size the bar, and hovering the bar reveals a
  // tooltip that names the biggest number (max spend period).
  const maxSpend = sorted.reduce(
    (m, p) => Math.max(m, Number(p.totalSpend)),
    0,
  )

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Spend Trend */}
      <Card>
        <CardHeader>
          <CardTitle>Spend by Period</CardTitle>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Monthly spend on this contract (last {sorted.length}{" "}
            {sorted.length === 1 ? "period" : "periods"}). Bar length is % of
            total contract value; dollar amount is actual spend this period.
          </p>
        </CardHeader>
        <CardContent>
          <TooltipProvider>
            <div className="space-y-3">
              {sorted.map((p) => {
                const spend = Number(p.totalSpend)
                const pct =
                  totalValue > 0
                    ? Math.min(Math.round((spend / totalValue) * 100), 100)
                    : 0
                const isMax = maxSpend > 0 && spend === maxSpend
                return (
                  <Tooltip key={p.id}>
                    <TooltipTrigger asChild>
                      <div className="cursor-help space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">
                            {formatCalendarDate(p.periodStart)} &ndash;{" "}
                            {formatCalendarDate(p.periodEnd)}
                          </span>
                          <span className="font-medium">
                            {formatCurrency(spend)}
                          </span>
                        </div>
                        <Progress value={pct} className="h-1.5" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[280px] p-3 text-xs">
                      <p className="font-medium">
                        {formatCalendarDate(p.periodStart)} – {formatCalendarDate(p.periodEnd)}
                      </p>
                      <p className="mt-1">
                        Spend on this contract only: {formatCurrency(spend)}
                        {totalValue > 0 && (
                          <>
                            {" "}
                            ({pct}% of contract total{" "}
                            {formatCurrency(totalValue)})
                          </>
                        )}
                      </p>
                      {isMax && sorted.length > 1 && (
                        <p className="mt-1 text-emerald-600">
                          Highest-spend period in view.
                        </p>
                      )}
                    </TooltipContent>
                  </Tooltip>
                )
              })}
            </div>
          </TooltipProvider>
        </CardContent>
      </Card>

      {/* Tier Achievement */}
      <Card>
        <CardHeader>
          <CardTitle>Tier Achievement</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {sorted.map((p) => {
              // Charles 2026-04-25: derive tier from this period's
              // actual totalSpend against the contract's ladder.
              // Falls back to p.tierAchieved if the contract has no
              // tiers (rare; legacy data).
              const periodSpend = Number(p.totalSpend)
              const sortedLadder = [...contractTiers].sort(
                (a, b) => a.spendMin - b.spendMin,
              )
              let derivedTier: number | null = null
              if (sortedLadder.length > 0) {
                for (const t of sortedLadder) {
                  if (periodSpend >= t.spendMin) derivedTier = t.tierNumber
                }
              } else if (p.tierAchieved != null) {
                derivedTier = p.tierAchieved
              }
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">
                    {formatCalendarDate(p.periodStart)} &ndash;{" "}
                    {formatCalendarDate(p.periodEnd)}
                  </span>
                  <span className="text-sm font-medium">
                    {derivedTier != null ? `Tier ${derivedTier}` : "N/A"}
                  </span>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
