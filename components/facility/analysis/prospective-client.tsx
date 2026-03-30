"use client"

import { useState, useMemo, useCallback } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { ProposalUpload } from "./proposal-upload"
import { ProposalComparisonTable } from "./proposal-comparison-table"
import { useAnalyzeProposal } from "@/hooks/use-prospective"
import type {
  ProposalAnalysis,
  DealScore,
  ItemComparison,
} from "@/lib/actions/prospective"
import {
  ResponsiveContainer,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip as RechartsTooltip,
} from "recharts"
import { chartTooltipStyle } from "@/lib/chart-config"
import {
  Target,
  Upload,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileText,
  DollarSign,
  Percent,
  ChevronRight,
  BarChart3,
  Download,
  FileSpreadsheet,
  Send,
  Trash2,
  Sparkles,
  X,
} from "lucide-react"

// ─── Recommendation display config ────────────────────────────

const RECOMMENDATION_LABELS: Record<
  string,
  { label: string; color: string; bgColor: string; borderColor: string }
> = {
  strong_accept: {
    label: "Favorable",
    color: "text-emerald-700 dark:text-emerald-300",
    bgColor: "bg-emerald-50/50 dark:bg-emerald-950/30",
    borderColor: "border-l-emerald-500",
  },
  accept: {
    label: "Favorable",
    color: "text-emerald-700 dark:text-emerald-300",
    bgColor: "bg-emerald-50/50 dark:bg-emerald-950/30",
    borderColor: "border-l-emerald-500",
  },
  negotiate: {
    label: "Needs Negotiation",
    color: "text-amber-700 dark:text-amber-300",
    bgColor: "bg-amber-50/50 dark:bg-amber-950/30",
    borderColor: "border-l-amber-500",
  },
  reject: {
    label: "Not Recommended",
    color: "text-red-700 dark:text-red-300",
    bgColor: "bg-red-50/50 dark:bg-red-950/30",
    borderColor: "border-l-red-500",
  },
}

// ─── Types ─────────────────────────────────────────────────────

interface ProspectiveClientProps {
  facilityId: string
}

// ─── Component ─────────────────────────────────────────────────

export function ProspectiveClient({ facilityId }: ProspectiveClientProps) {
  const [analysis, setAnalysis] = useState<ProposalAnalysis | null>(null)
  const [activeTab, setActiveTab] = useState("upload")

  // What-if scenario state
  const [scenarioDiscount, setScenarioDiscount] = useState(5)
  const [scenarioVolumeIncrease, setScenarioVolumeIncrease] = useState(10)

  const rec = analysis?.dealScore
    ? RECOMMENDATION_LABELS[analysis.dealScore.recommendation] ??
      RECOMMENDATION_LABELS.negotiate!
    : null

  // Radar chart data -- 6 dimensions to match v0 prototype
  const radarData = useMemo(() => {
    if (!analysis?.dealScore) return []
    const s = analysis.dealScore
    return [
      { dimension: "Financial Value", value: s.financialValue, fullMark: 100 },
      { dimension: "Rebate Efficiency", value: s.rebateEfficiency, fullMark: 100 },
      { dimension: "Pricing", value: s.pricingCompetitiveness, fullMark: 100 },
      { dimension: "Market Share", value: s.marketShareAlignment, fullMark: 100 },
      { dimension: "Compliance", value: s.complianceLikelihood, fullMark: 100 },
      {
        dimension: "Cost Savings",
        value: Math.min(
          100,
          Math.max(0, analysis.totalSavingsPercent * 10 + 50)
        ),
        fullMark: 100,
      },
    ]
  }, [analysis])

  // What-if scenario calculations
  const scenarioAnalysis = useMemo(() => {
    if (!analysis) return null
    const discountFactor = 1 - scenarioDiscount / 100
    const volumeFactor = 1 + scenarioVolumeIncrease / 100
    const newProposed = analysis.totalProposedCost * discountFactor
    const newCurrent = analysis.totalCurrentCost * volumeFactor
    const newSavings = newCurrent - newProposed
    const newSavingsPercent =
      newCurrent > 0 ? (newSavings / newCurrent) * 100 : 0
    return {
      totalProposedCost: Math.round(newProposed * 100) / 100,
      totalCurrentCost: Math.round(newCurrent * 100) / 100,
      totalSavings: Math.round(newSavings * 100) / 100,
      totalSavingsPercent: Math.round(newSavingsPercent * 100) / 100,
    }
  }, [analysis, scenarioDiscount, scenarioVolumeIncrease])

  // Build a comparison of current vs proposed terms for table
  const comparisonRows = useMemo(() => {
    if (!analysis) return []
    return [
      {
        term: "Total Cost",
        current: `$${analysis.totalCurrentCost.toLocaleString()}`,
        proposed: `$${analysis.totalProposedCost.toLocaleString()}`,
        delta:
          analysis.totalSavings >= 0
            ? `-$${analysis.totalSavings.toLocaleString()}`
            : `+$${Math.abs(analysis.totalSavings).toLocaleString()}`,
        favorable: analysis.totalSavings >= 0,
      },
      {
        term: "Avg Unit Price",
        current:
          analysis.itemComparisons.length > 0
            ? `$${(analysis.totalCurrentCost / analysis.itemComparisons.length).toFixed(2)}`
            : "--",
        proposed:
          analysis.itemComparisons.length > 0
            ? `$${(analysis.totalProposedCost / analysis.itemComparisons.length).toFixed(2)}`
            : "--",
        delta: `${analysis.totalSavingsPercent >= 0 ? "-" : "+"}${Math.abs(analysis.totalSavingsPercent).toFixed(1)}%`,
        favorable: analysis.totalSavingsPercent >= 0,
      },
      {
        term: "Items Below Current",
        current: "--",
        proposed: `${analysis.itemComparisons.filter((i) => i.savings > 0).length} items`,
        delta: "",
        favorable: true,
      },
      {
        term: "Items Above Current",
        current: "--",
        proposed: `${analysis.itemComparisons.filter((i) => i.savings < 0).length} items`,
        delta: "",
        favorable: false,
      },
    ]
  }, [analysis])

  // Negotiation points derived from analysis
  const negotiationPoints = useMemo(() => {
    if (!analysis?.dealScore) return []
    const s = analysis.dealScore
    const points: string[] = []
    if (s.pricingCompetitiveness < 50) {
      points.push(
        "Request market-competitive pricing - current offer may be above market benchmarks"
      )
    }
    if (s.rebateEfficiency < 50) {
      points.push(
        "Negotiate lower rebate thresholds - current minimums may be difficult to achieve based on historical spend"
      )
    }
    if (s.financialValue < 50) {
      points.push(
        "Push for better base pricing - proposal does not deliver significant savings vs current spend"
      )
    }
    if (s.marketShareAlignment < 50) {
      points.push(
        "Negotiate down market share commitments to maintain flexibility"
      )
    }
    if (s.complianceLikelihood < 60) {
      points.push(
        "Request early termination clause or reduce exclusivity requirements"
      )
    }
    if (s.financialValue >= 70) {
      points.push(
        "Strong savings vs current spend - consider locking in with multi-year term"
      )
    }
    if (s.rebateEfficiency >= 70) {
      points.push(
        "Rebate thresholds are achievable based on your historical spend patterns"
      )
    }
    return points
  }, [analysis])

  // Risk analysis derived from scores
  const risks = useMemo(() => {
    if (!analysis?.dealScore) return []
    const s = analysis.dealScore
    const r: string[] = []
    if (s.marketShareAlignment < 40) {
      r.push(
        "High market share commitment may limit clinical choice and flexibility"
      )
    }
    if (s.complianceLikelihood < 50) {
      r.push("Compliance requirements may be difficult to meet")
    }
    if (s.rebateEfficiency < 40) {
      r.push(
        "High risk of missing rebate thresholds based on current spend patterns"
      )
    }
    if (analysis.totalSavingsPercent < 0) {
      r.push(
        "Proposed pricing is higher than current cost - no price protection"
      )
    }
    return r
  }, [analysis])

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)

  // Variance color coding helper (red=bad, yellow=neutral, green=good)
  const getVarianceColor = (savingsPercent: number) => {
    if (savingsPercent > 5) return "text-emerald-600 dark:text-emerald-400"
    if (savingsPercent > 0) return "text-emerald-500 dark:text-emerald-400"
    if (savingsPercent > -3) return "text-amber-600 dark:text-amber-400"
    return "text-red-600 dark:text-red-400"
  }

  const getVarianceBg = (savingsPercent: number) => {
    if (savingsPercent > 5) return "bg-emerald-50 dark:bg-emerald-950/20"
    if (savingsPercent > 0) return "bg-emerald-50/50 dark:bg-emerald-950/10"
    if (savingsPercent > -3) return "bg-amber-50 dark:bg-amber-950/20"
    return "bg-red-50 dark:bg-red-950/20"
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Evaluate Vendor Proposals</h1>
          <p className="text-muted-foreground">
            Analyze vendor contracts from the facility perspective - score deals
            on savings, attainability, and risk
          </p>
        </div>
        {analysis && (
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" />
            Export Analysis
          </Button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card className="border-l-4 border-l-emerald-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Proposals Analyzed
                </p>
                <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {analysis ? 1 : 0}
                </p>
              </div>
              <FileText className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Avg Deal Score
                </p>
                <p className="text-2xl font-bold text-blue-600">
                  {analysis?.dealScore
                    ? analysis.dealScore.overall.toFixed(1)
                    : "-"}
                </p>
              </div>
              <Target className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-amber-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Total Value (COG-Based)
                </p>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {analysis
                    ? formatCurrency(analysis.totalProposedCost)
                    : "$0"}
                </p>
              </div>
              <DollarSign className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500">
          <CardContent className="pt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Est. Rebates</p>
                <p className="text-2xl font-bold text-purple-600">
                  {analysis
                    ? formatCurrency(Math.abs(analysis.totalSavings) * 0.03)
                    : "$0"}
                </p>
              </div>
              <Percent className="h-8 w-8 text-muted-foreground/30" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Proposal
          </TabsTrigger>
          <TabsTrigger value="pricing" className="gap-2">
            <FileSpreadsheet className="h-4 w-4" />
            Pricing Analysis
          </TabsTrigger>
          <TabsTrigger
            value="analysis"
            className="gap-2"
            disabled={!analysis}
          >
            <BarChart3 className="h-4 w-4" />
            Analysis
          </TabsTrigger>
          <TabsTrigger
            value="history"
            className="gap-2"
            disabled={!analysis}
          >
            <FileText className="h-4 w-4" />
            All Proposals ({analysis ? 1 : 0})
          </TabsTrigger>
        </TabsList>

        {/* ─── Upload Tab ─────────────────────────────────────── */}
        <TabsContent value="upload" className="space-y-6">
          <ProposalUpload
            facilityId={facilityId}
            onAnalyzed={(result) => {
              setAnalysis(result)
              setActiveTab("analysis")
            }}
          />

          {!analysis && (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  <Upload className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">No proposal analyzed yet</p>
                  <p className="text-sm mt-1">
                    Upload a vendor pricing CSV above to get started
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Pricing Analysis Tab ───────────────────────────── */}
        <TabsContent value="pricing" className="space-y-6">
          {analysis ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileSpreadsheet className="h-5 w-5" />
                  Line Item Pricing Comparison
                </CardTitle>
                <CardDescription>
                  {analysis.itemComparisons.length} items compared against
                  current COG pricing
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Summary Cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">
                      Items Analyzed
                    </p>
                    <p className="text-2xl font-bold">
                      {analysis.itemComparisons.length}
                    </p>
                  </div>
                  <div className="p-4 bg-muted/50 rounded-lg text-center">
                    <p className="text-sm text-muted-foreground">
                      Avg Price Variance
                    </p>
                    <p
                      className={`text-2xl font-bold ${
                        analysis.totalSavingsPercent >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {analysis.totalSavingsPercent >= 0 ? "-" : "+"}
                      {Math.abs(analysis.totalSavingsPercent).toFixed(1)}%
                    </p>
                  </div>
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg text-center border border-emerald-200 dark:border-emerald-900">
                    <p className="text-sm text-emerald-700 dark:text-emerald-300">
                      Items Below COG
                    </p>
                    <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {
                        analysis.itemComparisons.filter((i) => i.savings > 0)
                          .length
                      }
                    </p>
                  </div>
                  <div className="p-4 bg-red-50 dark:bg-red-950/20 rounded-lg text-center border border-red-200 dark:border-red-900">
                    <p className="text-sm text-red-700 dark:text-red-300">
                      Items Above COG
                    </p>
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                      {
                        analysis.itemComparisons.filter((i) => i.savings < 0)
                          .length
                      }
                    </p>
                  </div>
                </div>

                {/* Potential Savings Banner */}
                {analysis.totalSavings > 0 && (
                  <div className="p-4 bg-emerald-50 dark:bg-emerald-950/20 rounded-lg border border-emerald-200 dark:border-emerald-900">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-emerald-800 dark:text-emerald-200">
                          Potential Annual Savings
                        </p>
                        <p className="text-3xl font-bold text-emerald-600 dark:text-emerald-400">
                          {formatCurrency(analysis.totalSavings)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-emerald-700 dark:text-emerald-300">
                          Based on items priced below current COG
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Line Item Table with Variance Heatmap */}
                <div className="border rounded-lg overflow-hidden">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Item #</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">
                          Current Price
                        </TableHead>
                        <TableHead className="text-right">
                          Proposed Price
                        </TableHead>
                        <TableHead className="text-right">
                          Variance %
                        </TableHead>
                        <TableHead className="text-right">Savings</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {analysis.itemComparisons.slice(0, 20).map((item, i) => (
                        <TableRow
                          key={i}
                          className={getVarianceBg(item.savingsPercent)}
                        >
                          <TableCell className="font-mono text-sm">
                            {item.vendorItemNo}
                          </TableCell>
                          <TableCell className="max-w-[200px] truncate">
                            {item.description}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            ${item.currentPrice.toFixed(2)}
                          </TableCell>
                          <TableCell className="text-right">
                            ${item.proposedPrice.toFixed(2)}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${getVarianceColor(item.savingsPercent)}`}
                          >
                            {item.savingsPercent >= 0 ? "-" : "+"}
                            {Math.abs(item.savingsPercent).toFixed(1)}%
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${item.savings >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {item.savings >= 0 ? "" : "-"}$
                            {Math.abs(item.savings).toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                  {analysis.itemComparisons.length > 20 && (
                    <div className="p-3 text-center text-sm text-muted-foreground bg-muted/30">
                      Showing 20 of {analysis.itemComparisons.length} items
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardContent className="py-8">
                <div className="text-center text-muted-foreground">
                  <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
                  <p className="font-medium">
                    Upload a pricing file to compare
                  </p>
                  <p className="text-sm mt-1">
                    Compare vendor pricing against your current COG data
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── Analysis Tab ───────────────────────────────────── */}
        <TabsContent value="analysis" className="space-y-6">
          {analysis && (
            <>
              {/* Recommendation Banner */}
              {rec && (
                <Card
                  className={`border-l-4 ${rec.borderColor} ${rec.bgColor}`}
                >
                  <CardContent className="py-4">
                    <div className="flex items-center gap-4">
                      {analysis.dealScore.recommendation === "reject" ? (
                        <X className="h-8 w-8 text-red-600 dark:text-red-400" />
                      ) : analysis.dealScore.recommendation ===
                        "negotiate" ? (
                        <AlertTriangle className="h-8 w-8 text-amber-600 dark:text-amber-400" />
                      ) : (
                        <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
                      )}
                      <div className="flex-1">
                        <h3 className={`font-semibold text-lg ${rec.color}`}>
                          {rec.label}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          Overall Score: {analysis.dealScore.overall}/100 |{" "}
                          {analysis.itemComparisons.length} items analyzed
                        </p>
                      </div>
                      <Badge
                        variant={
                          analysis.dealScore.overall >= 65
                            ? "default"
                            : analysis.dealScore.overall >= 40
                              ? "secondary"
                              : "destructive"
                        }
                        className="text-sm px-3 py-1"
                      >
                        {analysis.dealScore.overall}/100
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Summary Stats */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Current Cost
                        </p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(analysis.totalCurrentCost)}
                        </p>
                      </div>
                      <DollarSign className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-amber-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Proposed Cost
                        </p>
                        <p className="text-2xl font-bold">
                          {formatCurrency(analysis.totalProposedCost)}
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>

                <Card
                  className={`border-l-4 ${analysis.totalSavings >= 0 ? "border-l-emerald-500" : "border-l-red-500"}`}
                >
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Savings
                        </p>
                        <p
                          className={`text-2xl font-bold ${analysis.totalSavings >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                        >
                          {formatCurrency(analysis.totalSavings)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {analysis.totalSavingsPercent >= 0 ? "" : "+"}
                          {Math.abs(analysis.totalSavingsPercent).toFixed(1)}%{" "}
                          {analysis.totalSavingsPercent >= 0
                            ? "savings"
                            : "increase"}
                        </p>
                      </div>
                      <Percent className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Radar Chart + Score Breakdown */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Deal Score Radar Chart - 6 dimensions */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5" />
                      Deal Score
                    </CardTitle>
                    <CardDescription>
                      Overall: {analysis.dealScore.overall}/100 —{" "}
                      {rec?.label ?? "Needs Negotiation"}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="h-[300px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <RadarChart data={radarData}>
                          <PolarGrid className="stroke-muted" />
                          <PolarAngleAxis
                            dataKey="dimension"
                            tick={{ fontSize: 10 }}
                            className="fill-muted-foreground"
                          />
                          <PolarRadiusAxis
                            angle={30}
                            domain={[0, 100]}
                            tick={{ fontSize: 10 }}
                          />
                          <Radar
                            name="Score"
                            dataKey="value"
                            stroke="#10b981"
                            fill="#10b981"
                            fillOpacity={0.3}
                            strokeWidth={2}
                          />
                          <RechartsTooltip contentStyle={chartTooltipStyle} />
                        </RadarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>

                {/* Score Breakdown with Progress Bars */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      Score Breakdown
                    </CardTitle>
                    <CardDescription>
                      Weighted evaluation across scoring dimensions
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {[
                      {
                        label: "Financial Value",
                        value: analysis.dealScore.financialValue,
                        color: "bg-blue-500",
                        desc: "Overall financial benefit of the deal",
                      },
                      {
                        label: "Rebate Efficiency",
                        value: analysis.dealScore.rebateEfficiency,
                        color: "bg-purple-500",
                        desc: "Likelihood and ease of earning rebates",
                      },
                      {
                        label: "Pricing Competitiveness",
                        value: analysis.dealScore.pricingCompetitiveness,
                        color: "bg-emerald-500",
                        desc: "Pricing compared to market benchmarks",
                      },
                      {
                        label: "Market Share Alignment",
                        value: analysis.dealScore.marketShareAlignment,
                        color: "bg-amber-500",
                        desc: "Compatibility with current vendor mix",
                      },
                      {
                        label: "Compliance Likelihood",
                        value: analysis.dealScore.complianceLikelihood,
                        color: "bg-teal-500",
                        desc: "Ability to meet contract requirements",
                      },
                    ].map((score) => (
                      <div key={score.label} className="space-y-1">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{score.label}</span>
                          <span className="text-muted-foreground">
                            {score.value}/100
                          </span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full ${score.color} transition-all`}
                            style={{ width: `${score.value}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {score.desc}
                        </p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </div>

              {/* Risk Analysis & Negotiation Points */}
              <div className="grid gap-6 lg:grid-cols-2">
                {/* Risk Analysis */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Risk Analysis
                    </CardTitle>
                    <CardDescription>
                      Identified concerns for your facility
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {risks.length > 0 ? (
                      <ul className="space-y-3">
                        {risks.map((risk, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-3 p-3 bg-red-50 dark:bg-red-950/20 rounded-lg border border-red-200 dark:border-red-900"
                          >
                            <AlertTriangle className="h-4 w-4 mt-0.5 text-red-600 dark:text-red-400 shrink-0" />
                            <span className="text-sm text-red-800 dark:text-red-200">
                              {risk}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                        <p className="text-sm">No major risks identified</p>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Negotiation Recommendations */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5" />
                      Negotiation Recommendations
                    </CardTitle>
                    <CardDescription>
                      AI-generated suggestions based on contract analysis
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    {negotiationPoints.length > 0 ? (
                      <ul className="space-y-2">
                        {negotiationPoints.map((point, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg"
                          >
                            <ChevronRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                            <span className="text-sm">{point}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-center py-6 text-muted-foreground">
                        <CheckCircle2 className="h-8 w-8 mx-auto mb-2 text-emerald-500" />
                        <p className="text-sm">
                          No negotiation points needed - terms are favorable
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Current vs Proposed Terms Table */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FileText className="h-5 w-5" />
                    Current vs Proposed Terms
                  </CardTitle>
                  <CardDescription>
                    Side-by-side comparison of current and proposed costs
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead>Term</TableHead>
                        <TableHead className="text-right">Current</TableHead>
                        <TableHead className="text-right">Proposed</TableHead>
                        <TableHead className="text-right">
                          Difference
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {comparisonRows.map((row) => (
                        <TableRow key={row.term}>
                          <TableCell className="font-medium">
                            {row.term}
                          </TableCell>
                          <TableCell className="text-right text-muted-foreground">
                            {row.current}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.proposed}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${row.favorable ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
                          >
                            {row.delta}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* What-If Scenario Section */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    What-If Scenario Analysis
                  </CardTitle>
                  <CardDescription>
                    Adjust volume and discount to see projected impact
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 sm:grid-cols-2">
                    {/* Additional Discount Slider */}
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <Label>Additional Discount</Label>
                        <span className="text-sm font-medium text-primary">
                          {scenarioDiscount}%
                        </span>
                      </div>
                      <Slider
                        value={[scenarioDiscount]}
                        onValueChange={(v) => setScenarioDiscount(v[0])}
                        min={0}
                        max={25}
                        step={1}
                      />
                      <p className="text-xs text-muted-foreground">
                        Negotiate an additional discount on proposed pricing
                      </p>
                    </div>

                    {/* Volume Increase Slider */}
                    <div className="space-y-3">
                      <div className="flex justify-between">
                        <Label>Volume Increase</Label>
                        <span className="text-sm font-medium text-primary">
                          {scenarioVolumeIncrease}%
                        </span>
                      </div>
                      <Slider
                        value={[scenarioVolumeIncrease]}
                        onValueChange={(v) =>
                          setScenarioVolumeIncrease(v[0])
                        }
                        min={0}
                        max={50}
                        step={5}
                      />
                      <p className="text-xs text-muted-foreground">
                        Projected volume increase from current baseline
                      </p>
                    </div>
                  </div>

                  {/* Scenario Results */}
                  {scenarioAnalysis && (
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div className="p-4 bg-muted/50 rounded-lg text-center">
                        <p className="text-sm text-muted-foreground">
                          Adj. Proposed Cost
                        </p>
                        <p className="text-xl font-bold">
                          {formatCurrency(scenarioAnalysis.totalProposedCost)}
                        </p>
                      </div>
                      <div className="p-4 bg-muted/50 rounded-lg text-center">
                        <p className="text-sm text-muted-foreground">
                          Adj. Current Cost
                        </p>
                        <p className="text-xl font-bold">
                          {formatCurrency(scenarioAnalysis.totalCurrentCost)}
                        </p>
                      </div>
                      <div
                        className={`p-4 rounded-lg text-center border ${
                          scenarioAnalysis.totalSavings >= 0
                            ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900"
                            : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                        }`}
                      >
                        <p className="text-sm text-muted-foreground">
                          Projected Savings
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            scenarioAnalysis.totalSavings >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {formatCurrency(scenarioAnalysis.totalSavings)}
                        </p>
                      </div>
                      <div className="p-4 bg-muted/50 rounded-lg text-center">
                        <p className="text-sm text-muted-foreground">
                          Savings %
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            scenarioAnalysis.totalSavingsPercent >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {scenarioAnalysis.totalSavingsPercent.toFixed(1)}%
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Item-Level Comparison */}
              <Card>
                <CardHeader>
                  <CardTitle>Item-Level Comparison</CardTitle>
                  <CardDescription>
                    {analysis.itemComparisons.length} items compared against
                    current COG pricing
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ProposalComparisonTable
                    comparisons={analysis.itemComparisons}
                  />
                </CardContent>
              </Card>

              {/* Action Buttons */}
              <Card>
                <CardContent className="py-4">
                  <div className="flex flex-wrap gap-3">
                    <Button className="gap-2">
                      <FileText className="h-4 w-4" />
                      Generate Report
                    </Button>
                    <Button variant="outline" className="gap-2">
                      <Download className="h-4 w-4" />
                      Export Analysis
                    </Button>
                    <Button variant="outline" className="gap-2">
                      <Send className="h-4 w-4" />
                      Share with Team
                    </Button>
                    <Button
                      variant="ghost"
                      className="gap-2 ml-auto text-muted-foreground"
                      onClick={() => {
                        setAnalysis(null)
                        setActiveTab("upload")
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      Clear Analysis
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        {/* ─── History / All Proposals Tab ─────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          {analysis && (
            <Card>
              <CardHeader>
                <CardTitle>Analyzed Proposals</CardTitle>
                <CardDescription>
                  All proposals you&apos;ve uploaded or entered for analysis
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Items</TableHead>
                      <TableHead>Current Cost</TableHead>
                      <TableHead>Proposed Cost</TableHead>
                      <TableHead>Score</TableHead>
                      <TableHead>Recommendation</TableHead>
                      <TableHead>Savings</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <TableRow
                      className="cursor-pointer"
                      onClick={() => setActiveTab("analysis")}
                    >
                      <TableCell className="font-medium">
                        {analysis.itemComparisons.length} items
                      </TableCell>
                      <TableCell>
                        {formatCurrency(analysis.totalCurrentCost)}
                      </TableCell>
                      <TableCell>
                        {formatCurrency(analysis.totalProposedCost)}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            analysis.dealScore.overall >= 65
                              ? "default"
                              : analysis.dealScore.overall >= 40
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {analysis.dealScore.overall}/100
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            analysis.dealScore.recommendation ===
                              "strong_accept" ||
                            analysis.dealScore.recommendation === "accept"
                              ? "default"
                              : analysis.dealScore.recommendation === "reject"
                                ? "destructive"
                                : "secondary"
                          }
                        >
                          {analysis.dealScore.recommendation === "strong_accept"
                            ? "Favorable"
                            : analysis.dealScore.recommendation === "accept"
                              ? "Favorable"
                              : analysis.dealScore.recommendation === "reject"
                                ? "Not Recommended"
                                : "Needs Negotiation"}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className={
                          analysis.totalSavings >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }
                      >
                        {formatCurrency(analysis.totalSavings)} (
                        {analysis.totalSavingsPercent.toFixed(1)}%)
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={(e) => {
                            e.stopPropagation()
                            setAnalysis(null)
                            setActiveTab("upload")
                          }}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
