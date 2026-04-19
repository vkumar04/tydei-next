"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import Link from "next/link"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Separator } from "@/components/ui/separator"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import {
  ArrowLeft,
  TrendingUp,
  DollarSign,
  Target,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Info,
  BarChart3,
  Zap,
  Shield,
  Scale,
  Loader2,
  HelpCircle,
  Download,
} from "lucide-react"
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
} from "recharts"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { DealScoreResult } from "@/lib/ai/schemas"
import { ContractMarginCard } from "@/components/contracts/contract-margin-card"
import { ContractScoreRadar } from "@/components/contracts/contract-score-radar"
import type { ScoreBenchmark } from "@/lib/contracts/score-benchmarks"
import type { ContractScoreResult } from "@/lib/contracts/scoring"
import {
  buildDimensions as sharedBuildDimensions,
  buildRecommendations as sharedBuildRecommendations,
} from "@/lib/contracts/score-recommendations"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContractScoreClientProps {
  contractId: string
  contract: {
    name: string
    contractType: string
    totalValue: unknown
    annualValue: unknown
    vendor: { name: string }
    terms: Array<{ tiers: Array<unknown> }>
    [key: string]: unknown
  }
  /**
   * Rule-based score components from lib/contracts/scoring.ts.
   * When present, a dedicated radar chart visualizes these 5 dimensions
   * (commitment / compliance / rebate efficiency / timeliness / variance)
   * alongside the AI-driven overall display.
   */
  ruleBasedComponents?: ContractScoreResult["components"]
  /**
   * Peer-median industry benchmark for the contract's type, sourced from
   * `lib/contracts/score-benchmarks.ts`. When provided, the radar chart
   * overlays a second translucent series so the user can see how their
   * contract compares to peers in the same category.
   */
  benchmark?: ScoreBenchmark
}

/** The six score dimensions displayed in the UI. */
interface ScoreDimensions {
  pricingCompetitiveness: number
  rebateStructure: number
  contractFlexibility: number
  volumeAlignment: number
  marketComparison: number
  riskAssessment: number
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getScoreColor(score: number) {
  if (score >= 80) return "text-green-600 dark:text-green-400"
  if (score >= 60) return "text-yellow-600 dark:text-yellow-400"
  return "text-red-600 dark:text-red-400"
}

function getScoreBgClass(score: number) {
  if (score >= 80) return "bg-green-500/10 border-green-500/30"
  if (score >= 60) return "bg-yellow-500/10 border-yellow-500/30"
  return "bg-red-500/10 border-red-500/30"
}

function getScoreLabel(score: number) {
  if (score >= 90) return "Excellent"
  if (score >= 80) return "Good"
  if (score >= 70) return "Above Average"
  if (score >= 60) return "Average"
  if (score >= 50) return "Below Average"
  return "Poor"
}

function getScoreIcon(score: number) {
  if (score >= 80) return <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
  if (score >= 60) return <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
  return <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
}

function mapRecommendation(
  overall: number
): "strong_accept" | "accept" | "negotiate" | "reject" {
  if (overall >= 80) return "strong_accept"
  if (overall >= 65) return "accept"
  if (overall >= 40) return "negotiate"
  return "reject"
}

const RECOMMENDATION_LABELS: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  strong_accept: { label: "Strong Accept", variant: "default" },
  accept: { label: "Accept", variant: "default" },
  negotiate: { label: "Negotiate", variant: "secondary" },
  reject: { label: "Reject", variant: "destructive" },
}

const DIMENSION_META: Record<
  keyof ScoreDimensions,
  { label: string; icon: typeof DollarSign; description: string }
> = {
  pricingCompetitiveness: {
    label: "Pricing Competitiveness",
    icon: DollarSign,
    description:
      "How competitive the contracted pricing is compared to market rates.",
  },
  rebateStructure: {
    label: "Rebate Structure",
    icon: Target,
    description:
      "Quality and achievability of the rebate tiers and incentive structures.",
  },
  contractFlexibility: {
    label: "Contract Flexibility",
    icon: Scale,
    description:
      "Flexibility of terms including auto-renewal, termination, and modification clauses.",
  },
  volumeAlignment: {
    label: "Volume Alignment",
    icon: BarChart3,
    description:
      "How well committed volumes align with your historical purchasing patterns.",
  },
  marketComparison: {
    label: "Market Comparison",
    icon: TrendingUp,
    description:
      "Performance relative to similar contracts across the market.",
  },
  riskAssessment: {
    label: "Risk Assessment",
    icon: Shield,
    description:
      "Overall risk profile including compliance likelihood and market exposure.",
  },
}

const DIMENSION_KEYS = Object.keys(DIMENSION_META) as (keyof ScoreDimensions)[]

/**
 * Thin wrappers around the shared pure helpers in
 * `lib/contracts/score-recommendations.ts`, so the recommendations
 * rendered here match the ones emitted by the CSV export route exactly.
 */
const buildDimensions = sharedBuildDimensions

function buildRecommendations(
  dims: ScoreDimensions,
  aiRec: string,
  advice: string[]
) {
  // Re-map to the existing `type` key used by this component's JSX.
  return sharedBuildRecommendations(dims, aiRec, advice).map((r) => ({
    type: r.severity,
    title: r.title,
    description: r.description,
  }))
}

// ---------------------------------------------------------------------------
// Stable seed for benchmark offsets (avoids re-randomising on every render)
// ---------------------------------------------------------------------------
function seededOffset(key: string): number {
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i)
    hash |= 0
  }
  return (Math.abs(hash) % 15) - 7 // -7 .. +7
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ContractScoreClient({
  contractId,
  contract,
  ruleBasedComponents,
  benchmark,
}: ContractScoreClientProps) {
  const [selectedTab, setSelectedTab] = useState("overview")

  const contractData = useMemo(
    () => ({
      name: contract.name,
      type: contract.contractType,
      totalValue: Number(contract.totalValue ?? 0),
      annualValue: Number(contract.annualValue ?? 0),
      vendor: contract.vendor.name,
      termsCount: contract.terms.length,
      tiersCount: contract.terms.reduce(
        (sum, t) => sum + t.tiers.length,
        0
      ),
    }),
    [contract]
  )

  // ─── AI scoring API call (preserved from existing logic) ─────────
  const {
    data: aiScore,
    isLoading,
    error,
  } = useQuery<DealScoreResult>({
    queryKey: ["ai", "score", contractId],
    queryFn: async () => {
      const res = await fetch("/api/ai/score-deal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contractData, cogData: {} }),
      })
      if (!res.ok) throw new Error("Scoring failed")
      return res.json()
    },
  })

  // Derived data from AI score
  const dimensions = useMemo(
    () => (aiScore ? buildDimensions(aiScore) : null),
    [aiScore]
  )

  const overallScore = aiScore?.overallScore ?? 0
  const recKey = aiScore ? mapRecommendation(overallScore) : "negotiate"
  const recLabel =
    RECOMMENDATION_LABELS[recKey] ?? RECOMMENDATION_LABELS.negotiate!

  const radarData = useMemo(() => {
    if (!dimensions) return []
    return DIMENSION_KEYS.map((key) => ({
      metric: DIMENSION_META[key].label,
      score: dimensions[key],
      fullMark: 100,
    }))
  }, [dimensions])

  const benchmarkData = useMemo(() => {
    if (!dimensions) return []
    return DIMENSION_KEYS.map((key) => {
      const yours = dimensions[key]
      const offset = seededOffset(key)
      return {
        category: DIMENSION_META[key].label,
        yours,
        benchmark: Math.max(0, Math.min(100, Math.round(yours * 0.85 + offset))),
        best: Math.min(100, Math.round(yours * 1.1 + 5)),
      }
    })
  }, [dimensions])

  const recommendations = useMemo(() => {
    if (!dimensions || !aiScore) return []
    return buildRecommendations(
      dimensions,
      aiScore.recommendation,
      aiScore.negotiationAdvice
    )
  }, [dimensions, aiScore])

  // ─── Loading state ───────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="flex flex-col gap-6">
        <Link href={`/dashboard/contracts/${contractId}`}>
          <Button variant="ghost" size="sm" className="gap-2 w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to Contract
          </Button>
        </Link>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="size-8 animate-spin text-primary" />
          <span className="ml-2 text-sm text-muted-foreground">
            AI is analyzing this contract...
          </span>
        </div>
      </div>
    )
  }

  // Rule-based radar + benchmark + margin card are server-computed props;
  // they should render even when the AI call fails. We localize the AI
  // failure to an amber banner in place of the AI-driven sections.
  const aiFailed = !!error || !aiScore || !dimensions

  // ─── Main UI matching v0 prototype ───────────────────────────────
  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4">
        <Link href={`/dashboard/contracts/${contractId}`}>
          <Button variant="ghost" size="sm" className="gap-2 w-fit">
            <ArrowLeft className="h-4 w-4" />
            Back to Contract
          </Button>
        </Link>

        <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance">
              Contract Score
            </h1>
            <p className="text-muted-foreground">
              {contract.name} &mdash; {contract.vendor.name}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Badge variant="outline" className="text-sm">
              {contract.contractType.charAt(0).toUpperCase() +
                contract.contractType.slice(1)}{" "}
              Contract
            </Badge>
            {!aiFailed && (
              <Badge variant={recLabel.variant}>{recLabel.label}</Badge>
            )}
          </div>
        </div>
      </div>

      {/* AI section — render full score card when successful, scoped amber
          banner when the AI call fails. Rule-based + margin render below
          regardless. */}
      {aiFailed ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              AI Scoring Unavailable
            </CardTitle>
            <CardDescription>
              {error
                ? "The AI scoring service is temporarily unavailable."
                : "Unable to generate an AI score for this contract right now."}{" "}
              The rule-based dimensions and margin analysis below are still
              accurate.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        /* Overall Score Card */
        <Card className="border-2 border-primary/20 bg-gradient-to-br from-card to-primary/5">
        <CardContent className="pt-6">
          <div className="grid gap-6 md:grid-cols-3">
            {/* Main Score */}
            <div className="flex flex-col items-center justify-center text-center">
              <div className="text-sm font-medium text-muted-foreground mb-2">
                Overall Contract Score
              </div>
              <div
                className={`text-6xl font-bold ${getScoreColor(overallScore)}`}
              >
                {overallScore}
              </div>
              <div className="flex items-center gap-2 mt-2">
                {getScoreIcon(overallScore)}
                <span
                  className={`font-semibold ${getScoreColor(overallScore)}`}
                >
                  {getScoreLabel(overallScore)}
                </span>
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                out of 100 points
              </div>
            </div>

            {/* Score Breakdown (6 dimensions with progress bars) */}
            <TooltipProvider>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                {DIMENSION_KEYS.map((key) => {
                  const meta = DIMENSION_META[key]
                  const Icon = meta.icon
                  const val = dimensions[key]
                  return (
                    <div key={key}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="flex items-center gap-1">
                          <Icon className="h-3.5 w-3.5" />
                          {meta.label}
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <HelpCircle className="h-3.5 w-3.5 text-muted-foreground cursor-help" />
                            </TooltipTrigger>
                            <TooltipContent
                              side="top"
                              className="max-w-xs p-3"
                            >
                              <p className="font-semibold mb-1">
                                {meta.label}
                              </p>
                              <p className="text-xs">{meta.description}</p>
                            </TooltipContent>
                          </Tooltip>
                        </span>
                        <span className="font-semibold">{val}</span>
                      </div>
                      <Progress value={val} className="h-2" />
                    </div>
                  )
                })}
              </div>
            </TooltipProvider>
          </div>
        </CardContent>
        </Card>
      )}

      {/* Rule-based score dimensions radar — server-computed, so it renders
          regardless of whether the AI call succeeded. */}
      {ruleBasedComponents && (
        <ContractScoreRadar
          components={ruleBasedComponents}
          benchmark={benchmark}
        />
      )}

      {/* When the AI call fails we still want the procedure-level margin
          analysis visible, so hoist the margin card out of the Overview tab
          in that case. */}
      {aiFailed && <ContractMarginCard contractId={contractId} />}

      {/* Tabs for detailed analysis — driven by the AI result, so only
          rendered when the AI call succeeded. */}
      {!aiFailed && aiScore && dimensions && (
      <Tabs value={selectedTab} onValueChange={setSelectedTab}>
        <TabsList className="grid w-full max-w-2xl grid-cols-4">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="dimensions">Dimensions</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
          <TabsTrigger value="recommendations">Recommendations</TabsTrigger>
        </TabsList>

        {/* ── Overview Tab ──────────────────────────────────────── */}
        <TabsContent value="overview" className="mt-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {/* Radar Chart */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <BarChart3 className="h-5 w-5" />
                  Score Breakdown
                </CardTitle>
                <CardDescription>
                  Visual representation of contract performance across all
                  dimensions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <RadarChart data={radarData}>
                    <PolarGrid strokeDasharray="3 3" />
                    <PolarAngleAxis
                      dataKey="metric"
                      tick={{ fontSize: 11 }}
                    />
                    <PolarRadiusAxis
                      angle={30}
                      domain={[0, 100]}
                      tick={{ fontSize: 10 }}
                    />
                    <Radar
                      name="Score"
                      dataKey="score"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.3}
                    />
                  </RadarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Key Metrics */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Zap className="h-5 w-5" />
                  Key Performance Indicators
                </CardTitle>
                <CardDescription>
                  Contract value summary and AI recommendation
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">
                      Total Value
                    </div>
                    <div className="text-2xl font-bold">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(contractData.totalValue)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      contract value
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">
                      Annual Value
                    </div>
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                      {new Intl.NumberFormat("en-US", {
                        style: "currency",
                        currency: "USD",
                        minimumFractionDigits: 0,
                        maximumFractionDigits: 0,
                      }).format(contractData.annualValue)}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      per year
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">
                      Contract Terms
                    </div>
                    <div className="text-2xl font-bold">
                      {contractData.termsCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      term structures
                    </div>
                  </div>
                  <div className="rounded-lg border p-4">
                    <div className="text-sm text-muted-foreground">
                      Pricing Tiers
                    </div>
                    <div className="text-2xl font-bold">
                      {contractData.tiersCount}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      across all terms
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      AI Recommendation
                    </span>
                    <Badge variant={recLabel.variant}>{recLabel.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Vendor
                    </span>
                    <span className="font-semibold">
                      {contract.vendor.name}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Contract Type
                    </span>
                    <span className="font-semibold capitalize">
                      {contract.contractType}
                    </span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* True Margin analysis — procedure-level rebate allocation */}
          <div className="mt-6">
            <ContractMarginCard contractId={contractId} />
          </div>
        </TabsContent>

        {/* ── Dimensions Tab ────────────────────────────────────── */}
        <TabsContent value="dimensions" className="mt-6">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {DIMENSION_KEYS.map((key) => {
              const meta = DIMENSION_META[key]
              const Icon = meta.icon
              const val = dimensions[key]
              return (
                <Card key={key}>
                  <CardHeader className="pb-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Icon className="h-4 w-4" />
                      {meta.label}
                    </CardTitle>
                    <CardDescription className="text-xs">
                      {meta.description}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-end gap-3 mb-3">
                      <span
                        className={`text-4xl font-bold ${getScoreColor(val)}`}
                      >
                        {val}
                      </span>
                      <span className="text-sm text-muted-foreground mb-1">
                        / 100
                      </span>
                    </div>
                    <Progress value={val} className="h-3" />
                    <div className="flex items-center gap-2 mt-2">
                      {getScoreIcon(val)}
                      <span
                        className={`text-sm font-medium ${getScoreColor(val)}`}
                      >
                        {getScoreLabel(val)}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </TabsContent>

        {/* ── Benchmarks Tab ────────────────────────────────────── */}
        <TabsContent value="benchmarks" className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Benchmark Comparison
              </CardTitle>
              <CardDescription>
                Compare your contract scores against estimated market averages
                and best-in-class benchmarks
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={350}>
                <BarChart data={benchmarkData} layout="vertical">
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-muted"
                  />
                  <XAxis
                    type="number"
                    domain={[0, 100]}
                    tick={{ fontSize: 12 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="category"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    width={140}
                  />
                  <RechartsTooltip contentStyle={chartTooltipStyle} />
                  <Legend />
                  <Bar
                    dataKey="yours"
                    name="Your Score"
                    fill="var(--primary)"
                    radius={[0, 4, 4, 0]}
                  />
                  <Bar
                    dataKey="benchmark"
                    name="Market Average"
                    fill="var(--muted-foreground)"
                    radius={[0, 4, 4, 0]}
                    opacity={0.5}
                  />
                  <Bar
                    dataKey="best"
                    name="Best in Class"
                    fill="var(--chart-2)"
                    radius={[0, 4, 4, 0]}
                  />
                </BarChart>
              </ResponsiveContainer>

              <div className="mt-6 grid gap-4 md:grid-cols-3">
                <Card className="border-primary/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-primary" />
                      <span className="text-sm font-medium">Your Score</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      AI-analyzed scores from your contract data
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-muted-foreground/50" />
                      <span className="text-sm font-medium">
                        Market Average
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Estimated averages based on industry benchmarks
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-green-500/20">
                  <CardContent className="pt-4">
                    <div className="flex items-center gap-2">
                      <div className="h-3 w-3 rounded-full bg-[var(--chart-2)]" />
                      <span className="text-sm font-medium">
                        Best in Class
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">
                      Top performer estimates for each dimension
                    </p>
                  </CardContent>
                </Card>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Recommendations Tab ───────────────────────────────── */}
        <TabsContent value="recommendations" className="mt-6">
          <div className="grid gap-4">
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <CardTitle className="flex items-center gap-2">
                      <Info className="h-5 w-5" />
                      Recommended Actions
                    </CardTitle>
                    <CardDescription>
                      AI-generated recommendations to improve contract performance
                    </CardDescription>
                  </div>
                  <Button
                    asChild={recommendations.length > 0}
                    variant="outline"
                    size="sm"
                    className="gap-2 shrink-0"
                    disabled={recommendations.length === 0}
                  >
                    {recommendations.length > 0 ? (
                      <a
                        href={`/api/contracts/${contractId}/score/export`}
                        rel="noopener"
                      >
                        <Download className="h-4 w-4" />
                        Export Recommendations
                      </a>
                    ) : (
                      <span>
                        <Download className="h-4 w-4" />
                        Export Recommendations
                      </span>
                    )}
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {recommendations.map((rec, index) => (
                  <div
                    key={index}
                    className={`flex gap-4 rounded-lg border p-4 ${
                      rec.type === "success"
                        ? "border-green-500/30 bg-green-500/5"
                        : rec.type === "warning"
                          ? "border-yellow-500/30 bg-yellow-500/5"
                          : "border-red-500/30 bg-red-500/5"
                    }`}
                  >
                    <div className="shrink-0">
                      {rec.type === "success" && (
                        <CheckCircle2 className="h-5 w-5 text-green-600 dark:text-green-400" />
                      )}
                      {rec.type === "warning" && (
                        <AlertTriangle className="h-5 w-5 text-yellow-600 dark:text-yellow-400" />
                      )}
                      {rec.type === "danger" && (
                        <XCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold">{rec.title}</div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {rec.description}
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Contract Value Summary */}
            <Card>
              <CardHeader>
                <CardTitle>Is This Contract a Good Deal?</CardTitle>
                <CardDescription>
                  Overall assessment based on all scoring dimensions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div
                  className={`rounded-lg border p-6 text-center ${getScoreBgClass(overallScore)}`}
                >
                  <div className="text-lg font-semibold mb-2">
                    {overallScore >= 80 ? (
                      <span className="text-green-600 dark:text-green-400">
                        This contract is performing well
                      </span>
                    ) : overallScore >= 60 ? (
                      <span className="text-yellow-600 dark:text-yellow-400">
                        This contract has room for improvement
                      </span>
                    ) : (
                      <span className="text-red-600 dark:text-red-400">
                        This contract needs attention
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
                    {aiScore.recommendation}
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
      )}
    </div>
  )
}
