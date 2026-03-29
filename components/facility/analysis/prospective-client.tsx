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
import { PageHeader } from "@/components/shared/page-header"
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
  Sparkles,
  SlidersHorizontal,
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
    <div className="space-y-6">
      <PageHeader
        title="Prospective Analysis"
        description="Upload vendor proposals and compare pricing against current COG data"
        action={
          analysis ? (
            <Button variant="outline" size="sm">
              <Download className="mr-2 h-4 w-4" />
              Export Analysis
            </Button>
          ) : undefined
        }
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-2">
            <Upload className="h-4 w-4" />
            Upload Proposal
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
            Comparison
          </TabsTrigger>
          <TabsTrigger
            value="scenario"
            className="gap-2"
            disabled={!analysis}
          >
            <SlidersHorizontal className="h-4 w-4" />
            What-If
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

        {/* Comparison Tab */}
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

        {/* What-If Scenario Tab */}
        <TabsContent value="scenario" className="space-y-6">
          {analysis && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5" />
                    What-If Scenario Analysis
                  </CardTitle>
                  <CardDescription>
                    Adjust parameters to model different negotiation outcomes
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-6 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>
                        Additional Discount on Proposed Pricing (%)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={50}
                        value={scenarioDiscount}
                        onChange={(e) =>
                          setScenarioDiscount(Number(e.target.value))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        What if you negotiate an additional{" "}
                        {scenarioDiscount}% off the proposed pricing?
                      </p>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        Volume Increase on Current Spend (%)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={scenarioVolumeIncrease}
                        onChange={(e) =>
                          setScenarioVolumeIncrease(Number(e.target.value))
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        What if your volume increases {scenarioVolumeIncrease}%
                        over the contract term?
                      </p>
                    </div>
                  </div>

                  <Separator />

                  {scenarioAnalysis && (
                    <div className="space-y-4">
                      <h4 className="font-medium">Scenario Results</h4>
                      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <div className="rounded-lg bg-muted/50 p-4 text-center">
                          <p className="text-sm text-muted-foreground">
                            Adjusted Current Cost
                          </p>
                          <p className="text-xl font-bold">
                            {formatCurrency(scenarioAnalysis.totalCurrentCost)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/50 p-4 text-center">
                          <p className="text-sm text-muted-foreground">
                            Adjusted Proposed Cost
                          </p>
                          <p className="text-xl font-bold">
                            {formatCurrency(
                              scenarioAnalysis.totalProposedCost
                            )}
                          </p>
                        </div>
                        <div
                          className={`rounded-lg p-4 text-center border ${
                            scenarioAnalysis.totalSavings >= 0
                              ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-900"
                              : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-900"
                          }`}
                        >
                          <p className="text-sm text-muted-foreground">
                            Scenario Savings
                          </p>
                          <p
                            className={`text-xl font-bold ${scenarioAnalysis.totalSavings >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {formatCurrency(scenarioAnalysis.totalSavings)}
                          </p>
                        </div>
                        <div className="rounded-lg bg-muted/50 p-4 text-center">
                          <p className="text-sm text-muted-foreground">
                            Savings %
                          </p>
                          <p
                            className={`text-xl font-bold ${scenarioAnalysis.totalSavingsPercent >= 0 ? "text-emerald-600" : "text-red-600"}`}
                          >
                            {scenarioAnalysis.totalSavingsPercent.toFixed(1)}%
                          </p>
                        </div>
                      </div>

                      <Separator />

                      {/* Comparison: original vs scenario */}
                      <Table>
                        <TableHeader>
                          <TableRow className="bg-muted/50">
                            <TableHead>Metric</TableHead>
                            <TableHead className="text-right">
                              Original Analysis
                            </TableHead>
                            <TableHead className="text-right">
                              What-If Scenario
                            </TableHead>
                            <TableHead className="text-right">
                              Improvement
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          <TableRow>
                            <TableCell className="font-medium">
                              Total Savings
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(analysis.totalSavings)}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatCurrency(scenarioAnalysis.totalSavings)}
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                scenarioAnalysis.totalSavings >
                                analysis.totalSavings
                                  ? "text-emerald-600"
                                  : "text-red-600"
                              }`}
                            >
                              {formatCurrency(
                                scenarioAnalysis.totalSavings -
                                  analysis.totalSavings
                              )}
                            </TableCell>
                          </TableRow>
                          <TableRow>
                            <TableCell className="font-medium">
                              Savings %
                            </TableCell>
                            <TableCell className="text-right">
                              {analysis.totalSavingsPercent.toFixed(1)}%
                            </TableCell>
                            <TableCell className="text-right">
                              {scenarioAnalysis.totalSavingsPercent.toFixed(1)}%
                            </TableCell>
                            <TableCell
                              className={`text-right font-medium ${
                                scenarioAnalysis.totalSavingsPercent >
                                analysis.totalSavingsPercent
                                  ? "text-emerald-600"
                                  : "text-red-600"
                              }`}
                            >
                              {(
                                scenarioAnalysis.totalSavingsPercent -
                                analysis.totalSavingsPercent
                              ).toFixed(1)}
                              pp
                            </TableCell>
                          </TableRow>
                        </TableBody>
                      </Table>

                      {/* Negotiation Hints */}
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base flex items-center gap-2">
                            <ChevronRight className="h-4 w-4" />
                            Negotiation Insights
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <ul className="space-y-2 text-sm">
                            {scenarioDiscount > 0 && (
                              <li className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                                <ChevronRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                                <span>
                                  Negotiating an additional {scenarioDiscount}%
                                  discount would save an extra{" "}
                                  {formatCurrency(
                                    scenarioAnalysis.totalSavings -
                                      analysis.totalSavings
                                  )}
                                </span>
                              </li>
                            )}
                            {scenarioVolumeIncrease > 0 && (
                              <li className="flex items-start gap-2 p-2 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                                <ChevronRight className="h-4 w-4 mt-0.5 text-blue-600 shrink-0" />
                                <span>
                                  If volume increases by{" "}
                                  {scenarioVolumeIncrease}%, your total
                                  addressable spend increases to{" "}
                                  {formatCurrency(
                                    scenarioAnalysis.totalCurrentCost
                                  )}
                                  , making the proposed pricing more impactful
                                </span>
                              </li>
                            )}
                            {analysis.totalSavingsPercent < 5 && (
                              <li className="flex items-start gap-2 p-2 bg-amber-50 dark:bg-amber-950/20 rounded-lg">
                                <AlertTriangle className="h-4 w-4 mt-0.5 text-amber-600 shrink-0" />
                                <span>
                                  Current savings of{" "}
                                  {analysis.totalSavingsPercent.toFixed(1)}% are
                                  below typical negotiation targets of 5-10%.
                                  Push for better pricing.
                                </span>
                              </li>
                            )}
                          </ul>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
