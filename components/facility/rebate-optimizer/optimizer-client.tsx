"use client"

import { useState, useMemo, useId } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { EmptyState } from "@/components/shared/empty-state"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import {
  DollarSign,
  TrendingUp,
  Target,
  Zap,
  Calculator,
  ArrowRight,
  ChevronRight,
  Sparkles,
  CheckCircle2,
} from "lucide-react"
import {
  useRebateOpportunities,
  useSetSpendTarget,
  useRebateOptimizerEngine,
} from "@/hooks/use-rebate-optimizer"
import {
  useRebateInsights,
  useRegenerateRebateInsights,
  useFlagRebateInsight,
  useRebateInsightFlags,
  useClearRebateInsightFlag,
} from "@/hooks/use-rebate-insights"
import { formatCurrency } from "@/lib/formatting"
import { toast } from "sonner"
import Link from "next/link"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"
import type { RebateOpportunity as EngineRebateOpportunity } from "@/lib/actions/rebate-optimizer-engine"
import { ScenarioBuilder, type RebateScenarioInput } from "./scenario-builder"
import { ResultCards } from "./result-cards"
import { SensitivityChart } from "./sensitivity-chart"
import { CompareScenariosTable } from "./compare-scenarios-table"
import { evaluateScenario } from "./scenario-math"
import type { SavedScenario } from "./scenario-types"
import { RebateInsightCard } from "./rebate-insight-card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronDown, Loader2, RefreshCw, X } from "lucide-react"
import type { RebateInsight } from "@/lib/ai/rebate-optimizer-schemas"

interface OptimizerClientProps {
  facilityId: string
}

export function RebateOptimizerClient({ facilityId }: OptimizerClientProps) {
  const [vendorFilter, setVendorFilter] = useState("all")
  const [calculatorOpen, setCalculatorOpen] = useState(false)
  const [selectedContract, setSelectedContract] =
    useState<RebateOpportunity | null>(null)
  const [additionalSpend, setAdditionalSpend] = useState("")

  // ─── AI Smart Recommendations (Tier 1) ──────────────────────────
  const [insightsOpen, setInsightsOpen] = useState(false)
  const [insightsEnabled, setInsightsEnabled] = useState(false)
  const insightsQuery = useRebateInsights(facilityId, { enabled: insightsEnabled })
  const regenerateInsights = useRegenerateRebateInsights(facilityId)
  const flagInsight = useFlagRebateInsight(facilityId)
  const clearFlag = useClearRebateInsightFlag(facilityId)
  const flagsQuery = useRebateInsightFlags(facilityId)

  const insightsData = insightsQuery.data ?? regenerateInsights.data ?? null
  const insightsLoading =
    (insightsEnabled && insightsQuery.isPending && !insightsQuery.data) ||
    regenerateInsights.isPending
  const insightsError = insightsQuery.error ?? regenerateInsights.error ?? null
  const flaggedInsightIds = new Set(
    (flagsQuery.data ?? []).map((f) => f.insightId),
  )

  function handleGenerateInsights() {
    if (!insightsEnabled) {
      setInsightsEnabled(true)
      return
    }
    regenerateInsights.mutate()
  }

  function handleFlagInsight(insight: RebateInsight) {
    flagInsight.mutate(
      { insightId: insight.id, snapshot: insight },
      {
        onSuccess: () => toast.success("Flagged for review"),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Could not flag insight",
          ),
      },
    )
  }

  const { data: opportunities, isLoading } = useRebateOpportunities(facilityId)
  const setTarget = useSetSpendTarget()

  // ─── Scenario builder state ──────────────────────────────────────
  const scenarioIdSeed = useId()
  const {
    data: engineData,
    isLoading: isEngineLoading,
  } = useRebateOptimizerEngine(facilityId)
  const engineOpportunities: EngineRebateOpportunity[] = useMemo(
    () => engineData?.opportunities ?? [],
    [engineData],
  )
  const [scenarios, setScenarios] = useState<SavedScenario[]>([])
  const [activeOpportunityId, setActiveOpportunityId] = useState<string | null>(
    null,
  )

  const activeOpportunity = useMemo<EngineRebateOpportunity | null>(() => {
    if (activeOpportunityId) {
      const match = engineOpportunities.find(
        (o) => o.contractId === activeOpportunityId,
      )
      if (match) return match
    }
    return engineOpportunities[0] ?? null
  }, [engineOpportunities, activeOpportunityId])

  const latestEvaluation = useMemo(() => {
    if (scenarios.length === 0) return null
    const sameContract = [...scenarios]
      .reverse()
      .find((s) => s.input.contractId === activeOpportunity?.contractId)
    if (sameContract) return sameContract.evaluation
    return scenarios[scenarios.length - 1]?.evaluation ?? null
  }, [scenarios, activeOpportunity])

  const optimalScenario = useMemo(() => {
    if (scenarios.length === 0) return null
    return scenarios.reduce<SavedScenario | null>((best, s) => {
      if (!best) return s
      return s.evaluation.rebateDelta > best.evaluation.rebateDelta ? s : best
    }, null)
  }, [scenarios])

  function handleAddScenario(input: RebateScenarioInput) {
    const evaluation = evaluateScenario(input.opportunity, input.projectedSpend)
    const id = `${scenarioIdSeed}-${scenarios.length}-${Date.now()}`
    setScenarios((prev) => [
      ...prev,
      { id, input, evaluation, createdAt: Date.now() },
    ])
    setActiveOpportunityId(input.opportunity.contractId)
  }

  function handleRemoveScenario(id: string) {
    setScenarios((prev) => prev.filter((s) => s.id !== id))
  }

  function handleClearScenarios() {
    setScenarios([])
  }

  // Unique vendors for filter
  const vendors = useMemo(() => {
    if (!opportunities) return []
    return [...new Set(opportunities.map((o) => o.vendorName))]
  }, [opportunities])

  // Filtered opportunities
  const filtered = useMemo(() => {
    if (!opportunities) return []
    if (vendorFilter === "all") return opportunities
    return opportunities.filter((o) => o.vendorName === vendorFilter)
  }, [opportunities, vendorFilter])

  // Summary stats
  const stats = useMemo(() => {
    if (!opportunities)
      return {
        totalEarned: 0,
        totalPotential: 0,
        highUrgency: 0,
        contractCount: 0,
      }
    const totalEarned = opportunities.reduce(
      (sum, o) => sum + (o.currentSpend * (o.currentRebatePercent || 0)) / 100,
      0
    )
    const totalPotential = opportunities.reduce(
      (sum, o) => sum + o.projectedAdditionalRebate,
      0
    )
    const highUrgency = opportunities.filter(
      (o) => o.percentToNextTier >= 70
    ).length
    const contractCount = opportunities.length
    return { totalEarned, totalPotential, highUrgency, contractCount }
  }, [opportunities])

  // Sort by projected additional rebate (ROI proxy)
  const sortedOpportunities = useMemo(() => {
    return [...filtered].sort(
      (a, b) => b.projectedAdditionalRebate - a.projectedAdditionalRebate
    )
  }, [filtered])

  // Chart data
  const chartData = useMemo(() => {
    return filtered.map((o) => ({
      name: o.contractName,
      vendor: o.vendorName,
      earned: (o.currentSpend * (o.currentRebatePercent || 0)) / 100,
      potential: o.projectedAdditionalRebate,
    }))
  }, [filtered])

  const handleOpenCalculator = (opp: RebateOpportunity) => {
    setSelectedContract(opp)
    setCalculatorOpen(true)
    setAdditionalSpend("")
  }

  const calculateNewRebate = () => {
    if (!selectedContract || !additionalSpend) return null
    const add = parseFloat(additionalSpend)
    if (isNaN(add) || add <= 0) return null
    const newSpend = selectedContract.currentSpend + add
    const newTier =
      newSpend >= selectedContract.nextTierThreshold
        ? selectedContract.nextTier
        : selectedContract.currentTier
    const newRebatePercent =
      newSpend >= selectedContract.nextTierThreshold
        ? selectedContract.nextRebatePercent
        : selectedContract.currentRebatePercent
    const newRebate = (newSpend * newRebatePercent) / 100
    const oldRebate =
      (selectedContract.currentSpend * selectedContract.currentRebatePercent) / 100
    return {
      newSpend,
      newTier,
      newRebatePercent,
      newRebate,
      increase: newRebate - oldRebate,
    }
  }

  const calculatedResult = calculateNewRebate()

  // Best opportunity
  const bestOpp = sortedOpportunities[0] ?? null

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Rebate Tier Optimizer
          </h1>
          <p className="text-muted-foreground">
            Maximize rebate earnings by reaching higher tier thresholds
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" asChild>
            <Link href="/dashboard/reports">View Rebate Reports</Link>
          </Button>
        </div>
      </div>

      {/* ─── Smart Recommendations (AI) ─────────────────────────── */}
      <Card className="border-purple-200 bg-gradient-to-br from-purple-50/50 to-transparent dark:border-purple-900/50 dark:from-purple-950/20">
        <Collapsible open={insightsOpen} onOpenChange={setInsightsOpen}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-3">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex flex-1 items-center gap-2 text-left"
                >
                  <Sparkles className="h-5 w-5 text-purple-500" />
                  <div>
                    <CardTitle className="text-base">
                      Smart Recommendations (AI)
                      {flagsQuery.data && flagsQuery.data.length > 0 && (
                        <Badge variant="secondary" className="ml-2">
                          {flagsQuery.data.length} flagged
                        </Badge>
                      )}
                    </CardTitle>
                    <CardDescription className="mt-0.5">
                      Claude Opus analyzes your portfolio for cross-contract
                      opportunities — roughly 10 seconds to generate.
                    </CardDescription>
                  </div>
                  <ChevronDown
                    className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${
                      insightsOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              {insightsOpen && insightsData && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateInsights.mutate()}
                  disabled={insightsLoading}
                  className="gap-1"
                >
                  {regenerateInsights.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                  Regenerate
                </Button>
              )}
            </div>
          </CardHeader>
          <CollapsibleContent>
            <CardContent className="space-y-4">
              {!insightsEnabled && !insightsData && (
                <div className="flex flex-col items-start gap-3 rounded-md border border-dashed p-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
                  <div className="flex items-center gap-3">
                    <Sparkles className="h-6 w-6 text-purple-500" />
                    <div>
                      <p className="text-sm font-medium">
                        Generate AI Smart Recommendations
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Portfolio-level insights with citations back to each
                        contract. Cached for 15 minutes.
                      </p>
                    </div>
                  </div>
                  <Button onClick={handleGenerateInsights} className="gap-1">
                    <Sparkles className="h-4 w-4" />
                    Generate Smart Recommendations
                  </Button>
                </div>
              )}

              {insightsLoading && (
                <div className="space-y-3">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-[120px] rounded-xl" />
                  ))}
                </div>
              )}

              {!insightsLoading && insightsError && (
                <Alert variant="destructive">
                  <AlertTitle>Could not generate recommendations</AlertTitle>
                  <AlertDescription>
                    {insightsError instanceof Error
                      ? insightsError.message
                      : "Unknown error"}
                  </AlertDescription>
                </Alert>
              )}

              {!insightsLoading &&
                !insightsError &&
                insightsData &&
                insightsData.insights.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No actionable recommendations right now. Claude may surface
                    more once you have additional tier-gap contracts or
                    recent spend activity.
                  </p>
                )}

              {!insightsLoading &&
                insightsData &&
                insightsData.insights.length > 0 && (
                  <div className="space-y-3">
                    {insightsData.insights.map((insight) => (
                      <RebateInsightCard
                        key={insight.id}
                        insight={insight}
                        onFlag={handleFlagInsight}
                        isFlagging={flagInsight.isPending}
                        isFlagged={flaggedInsightIds.has(insight.id)}
                      />
                    ))}
                    {insightsData.observations &&
                      insightsData.observations.length > 0 && (
                        <div className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
                          <p className="font-medium">Observations</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4">
                            {insightsData.observations.map((obs, i) => (
                              <li key={i}>{obs}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    <p className="pt-1 text-[10px] text-muted-foreground">
                      Generated {new Date(insightsData.generatedAt).toLocaleString()}
                    </p>
                  </div>
                )}

              {flagsQuery.data && flagsQuery.data.length > 0 && (
                <div className="rounded-md border bg-muted/30 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-medium">Flagged follow-ups</p>
                    <Badge variant="secondary">{flagsQuery.data.length}</Badge>
                  </div>
                  <ul className="space-y-2">
                    {flagsQuery.data.map((flag) => (
                      <li
                        key={flag.id}
                        className="flex items-start justify-between gap-2 rounded border bg-background p-2 text-xs"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-medium">{flag.title}</p>
                          <p className="truncate text-muted-foreground">
                            {flag.summary}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => clearFlag.mutate(flag.id)}
                          disabled={clearFlag.isPending}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </CollapsibleContent>
        </Collapsible>
      </Card>

      {/* Scenario Builder — loading, empty, and loaded states */}
      {isEngineLoading ? (
        <div className="grid gap-4">
          <Skeleton className="h-[280px] rounded-xl" />
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[120px] rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-[360px] rounded-xl" />
        </div>
      ) : engineOpportunities.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title="No optimizable contracts"
          description="Add contracts with tiered spend rebates to start building what-if scenarios."
        />
      ) : (
        <div className="space-y-6">
          <ScenarioBuilder
            opportunities={engineOpportunities}
            onAddScenario={handleAddScenario}
          />

          <ResultCards
            opportunity={activeOpportunity}
            currentEvaluation={latestEvaluation}
            optimalScenario={
              optimalScenario
                ? {
                    label: optimalScenario.input.label,
                    evaluation: optimalScenario.evaluation,
                  }
                : null
            }
          />

          <SensitivityChart
            opportunity={activeOpportunity}
            activeEvaluation={latestEvaluation}
          />

          <CompareScenariosTable
            scenarios={scenarios}
            optimalId={optimalScenario?.id ?? null}
            onRemove={handleRemoveScenario}
            onClearAll={handleClearScenarios}
          />
        </div>
      )}

      {/* Summary Cards */}
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-l-4 border-l-green-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Earned YTD</p>
                  <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                    {formatCurrency(stats.totalEarned)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    from {stats.contractCount} contracts
                  </p>
                </div>
                <DollarSign className="h-8 w-8 text-green-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-blue-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Potential Additional
                  </p>
                  <p className="text-2xl font-bold text-blue-600">
                    {formatCurrency(stats.totalPotential)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    if all next tiers reached
                  </p>
                </div>
                <TrendingUp className="h-8 w-8 text-blue-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-yellow-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Close to Next Tier
                  </p>
                  <p className="text-2xl font-bold">{stats.highUrgency}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    contracts within $100K
                  </p>
                </div>
                <Target className="h-8 w-8 text-yellow-500/50" />
              </div>
            </CardContent>
          </Card>

          <Card className="border-l-4 border-l-purple-500">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    Best Opportunity
                  </p>
                  <p
                    className="text-2xl font-bold truncate max-w-[180px]"
                    title={bestOpp?.contractName || "N/A"}
                  >
                    {bestOpp?.contractName || "N/A"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {bestOpp
                      ? `${formatCurrency(bestOpp.projectedAdditionalRebate)} potential`
                      : "N/A"}
                  </p>
                </div>
                <Sparkles className="h-8 w-8 text-purple-500/50" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Quick Win Alert */}
      {stats.highUrgency > 0 && (
        <Alert className="border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/30">
          <Zap className="h-4 w-4 text-yellow-600" />
          <AlertTitle className="text-yellow-800 dark:text-yellow-200">
            Quick Win Opportunities
          </AlertTitle>
          <AlertDescription className="text-yellow-700 dark:text-yellow-300">
            {stats.highUrgency} contract(s) are close to the next rebate tier.
            Consider consolidating purchases to maximize rebates before period
            end.
          </AlertDescription>
        </Alert>
      )}

      {/* Rebate Chart */}
      {!isLoading && chartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Rebate Earnings by Contract</CardTitle>
            <CardDescription>
              Current earned vs potential additional rebates by contract
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    type="number"
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}K`}
                    tick={{ fill: "var(--muted-foreground)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={100}
                    tick={{ fill: "var(--foreground)" }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <Tooltip
                    formatter={(value) => formatCurrency(Number(value))}
                    contentStyle={{
                      backgroundColor: "var(--card)",
                      border: "1px solid var(--border)",
                      borderRadius: "8px",
                      color: "var(--foreground)",
                    }}
                    labelStyle={{ color: "var(--foreground)" }}
                  />
                  <Bar
                    dataKey="earned"
                    name="Earned"
                    stackId="a"
                    fill="var(--chart-1)"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="potential"
                    name="Potential"
                    stackId="a"
                    fill="var(--chart-2)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Contract Tier Progress */}
      {!isLoading && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle>Contract Tier Progress</CardTitle>
                <CardDescription>
                  Track progress toward rebate tier thresholds
                </CardDescription>
              </div>
              <Select value={vendorFilter} onValueChange={setVendorFilter}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder="Filter by vendor" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Vendors</SelectItem>
                  {vendors.map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {filtered.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">
                  No rebate opportunities found.
                </p>
              ) : (
                filtered.map((contract) => {
                  const progressToNext = contract.percentToNextTier

                  return (
                    <div
                      key={`${contract.contractId}-${contract.currentTier}`}
                      className="p-4 rounded-lg border"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div>
                          <div className="flex items-center gap-2">
                            <h4 className="font-semibold">
                              {contract.contractName}
                            </h4>
                            <Badge variant="outline">
                              Tier {contract.currentTier} &rarr;{" "}
                              {contract.nextTier}
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {contract.vendorName}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-muted-foreground">
                            Current Rebate
                          </p>
                          <p className="text-lg font-bold text-green-600 dark:text-green-400">
                            {contract.currentRebatePercent}%
                          </p>
                        </div>
                      </div>

                      {/* Tier Progress */}
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-sm">
                          <span>
                            Current Spend:{" "}
                            {formatCurrency(contract.currentSpend)}
                          </span>
                          <span className="text-muted-foreground">
                            Next Tier:{" "}
                            {formatCurrency(contract.nextTierThreshold)} (
                            {contract.nextTier}%)
                          </span>
                        </div>

                        {/* Visual tier progress */}
                        <Progress
                          value={Math.min(progressToNext, 100)}
                          className="h-4"
                        />

                        {/* Opportunity highlight */}
                        {contract.spendGap > 0 && (
                          <div className="mt-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Sparkles className="h-4 w-4 text-blue-600" />
                                <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                                  {formatCurrency(contract.spendGap)} more to
                                  unlock {contract.nextTier}% rebate
                                </span>
                              </div>
                              <Badge
                                className={
                                  contract.percentToNextTier >= 70
                                    ? "bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300"
                                    : contract.percentToNextTier >= 40
                                      ? "bg-yellow-100 dark:bg-yellow-900/30 text-yellow-800 dark:text-yellow-300"
                                      : "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-300"
                                }
                              >
                                {contract.percentToNextTier >= 70
                                  ? "Quick Win"
                                  : contract.percentToNextTier >= 40
                                    ? "Moderate"
                                    : "Long Term"}
                              </Badge>
                            </div>
                            <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                              Potential additional rebate:{" "}
                              {formatCurrency(
                                contract.projectedAdditionalRebate
                              )}
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-end gap-2 mt-4">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleOpenCalculator(contract)}
                        >
                          <Calculator className="mr-2 h-4 w-4" />
                          Calculate
                        </Button>
                        <Button size="sm" asChild>
                          <Link
                            href={`/dashboard/contracts/${contract.contractId}`}
                          >
                            View Contract
                            <ChevronRight className="ml-1 h-4 w-4" />
                          </Link>
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* AI Recommendations */}
      {!isLoading && sortedOpportunities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              AI Recommendations
            </CardTitle>
            <CardDescription>
              Suggested actions to maximize rebate earnings
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {sortedOpportunities.slice(0, 3).map((opp, idx) => (
                <div
                  key={`${opp.contractId}-rec-${idx}`}
                  className="flex items-start gap-4 p-4 rounded-lg border"
                >
                  <div
                    className={`flex items-center justify-center w-8 h-8 rounded-full text-white text-sm font-bold ${
                      idx === 0
                        ? "bg-green-500"
                        : idx === 1
                          ? "bg-blue-500"
                          : "bg-gray-500"
                    }`}
                  >
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <h4 className="font-medium">
                      {opp.vendorName} - {opp.contractName}
                    </h4>
                    <p className="text-sm text-muted-foreground mt-1">
                      Increase spend by {formatCurrency(opp.spendGap)} to reach
                      Tier {opp.nextTier} and earn an additional{" "}
                      {formatCurrency(opp.projectedAdditionalRebate)} in
                      rebates.
                    </p>
                    <div className="flex items-center gap-4 mt-2 text-sm">
                      <span className="text-muted-foreground">
                        Progress:{" "}
                        <span className="font-medium text-foreground">
                          {opp.percentToNextTier.toFixed(0)}%
                        </span>
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenCalculator(opp)}
                  >
                    Take Action
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Calculator Dialog */}
      <Dialog open={calculatorOpen} onOpenChange={setCalculatorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Calculator className="h-5 w-5" />
              Rebate Calculator
            </DialogTitle>
            <DialogDescription>
              {selectedContract?.vendorName} - {selectedContract?.contractName}
            </DialogDescription>
          </DialogHeader>

          {selectedContract && (
            <div className="space-y-6">
              <div className="p-4 rounded-lg bg-muted/50">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Current Spend</p>
                    <p className="font-medium">
                      {formatCurrency(selectedContract.currentSpend)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Current Tier</p>
                    <p className="font-medium">
                      Tier {selectedContract.currentTier} (
                      {selectedContract.currentTier}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Current Rebate</p>
                    <p className="font-medium text-green-600 dark:text-green-400">
                      {formatCurrency(
                        (selectedContract.currentSpend *
                          selectedContract.currentTier) /
                          100
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Next Tier</p>
                    <p className="font-medium">
                      {formatCurrency(selectedContract.nextTierThreshold)} (
                      {selectedContract.nextTier}%)
                    </p>
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="additional-spend">
                  Additional Spend Amount
                </Label>
                <div className="relative">
                  <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="additional-spend"
                    type="number"
                    placeholder="Enter amount..."
                    value={additionalSpend}
                    onChange={(e) => setAdditionalSpend(e.target.value)}
                    className="pl-9"
                  />
                </div>
              </div>

              {/* Quick amounts */}
              <div className="flex gap-2">
                {[50000, 100000, 250000].map((amount) => (
                  <Button
                    key={amount}
                    variant="outline"
                    size="sm"
                    onClick={() => setAdditionalSpend(amount.toString())}
                  >
                    +{formatCurrency(amount)}
                  </Button>
                ))}
              </div>

              {/* Result */}
              {calculatedResult && (
                <div className="p-4 rounded-lg border bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800">
                  <h4 className="font-medium text-green-800 dark:text-green-200 mb-3">
                    Projected Result
                  </h4>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-muted-foreground">New Total Spend</p>
                      <p className="font-medium">
                        {formatCurrency(calculatedResult.newSpend)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">New Tier</p>
                      <p className="font-medium">
                        Tier {calculatedResult.newTier} (
                        {calculatedResult.newRebatePercent}%)
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">New Rebate</p>
                      <p className="font-medium text-green-600 dark:text-green-400">
                        {formatCurrency(calculatedResult.newRebate)}
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Increase</p>
                      <p className="font-medium text-green-600 dark:text-green-400">
                        +{formatCurrency(calculatedResult.increase)}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setCalculatorOpen(false)}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
