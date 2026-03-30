"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import { ProposalUpload } from "./proposal-upload"
import { ProposalComparisonTable } from "./proposal-comparison-table"
import { DealScoreRadar } from "./deal-score-radar"
import { useAnalyzeProposal } from "@/hooks/use-prospective"
import type { ProposalAnalysis, DealScore, ItemComparison } from "@/lib/actions/prospective"
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
} from "lucide-react"

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

interface ProspectiveClientProps {
  facilityId: string
}

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
      { dimension: "Financial Value", value: s.financialValue },
      { dimension: "Rebate Efficiency", value: s.rebateEfficiency },
      { dimension: "Pricing", value: s.pricingCompetitiveness },
      { dimension: "Market Share", value: s.marketShareAlignment },
      { dimension: "Compliance", value: s.complianceLikelihood },
      {
        dimension: "Cost Savings",
        value: Math.min(100, Math.max(0, analysis.totalSavingsPercent * 10 + 50)),
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
    const newSavingsPercent = newCurrent > 0 ? (newSavings / newCurrent) * 100 : 0
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

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)

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
                <p className="text-2xl font-bold text-emerald-600">
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
                  {analysis?.dealScore ? analysis.dealScore.overall.toFixed(1) : "-"}
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
                <p className="text-2xl font-bold text-amber-600">
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
                    ? formatCurrency(
                        Math.abs(analysis.totalSavings) * 0.03
                      )
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
            value="comparison"
            className="gap-2"
            disabled={!analysis}
          >
            <FileText className="h-4 w-4" />
            All Proposals ({analysis ? 1 : 0})
          </TabsTrigger>
        </TabsList>

        {/* Upload Tab */}
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

        {/* Pricing Analysis Tab */}
        <TabsContent value="pricing" className="space-y-6">
          <Card>
            <CardContent className="py-8">
              <div className="text-center text-muted-foreground">
                <FileSpreadsheet className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="font-medium">Upload a pricing file to compare</p>
                <p className="text-sm mt-1">
                  Compare vendor pricing against your current COG data
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analysis Tab */}
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
                        <AlertTriangle className="h-8 w-8 text-red-600" />
                      ) : analysis.dealScore.recommendation ===
                        "negotiate" ? (
                        <AlertTriangle className="h-8 w-8 text-amber-600" />
                      ) : (
                        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
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
                          className={`text-2xl font-bold ${analysis.totalSavings >= 0 ? "text-emerald-600" : "text-red-600"}`}
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
                <DealScoreRadar score={analysis.dealScore} />

                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Target className="h-5 w-5" />
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
            </>
          )}
        </TabsContent>

        {/* Comparison / All Proposals Tab */}
        <TabsContent value="comparison" className="space-y-6">
          {analysis && (
            <>
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
                            className={`text-right font-medium ${row.favorable ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {row.delta}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
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
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
