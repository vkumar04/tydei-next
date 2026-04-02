"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ProposalComparisonTable } from "../proposal-comparison-table"
import { DealScorePanel } from "./deal-score-panel"
import type { ProposalAnalysis } from "@/lib/actions/prospective"
import {
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  FileText,
  DollarSign,
  Percent,
  ChevronRight,
  Download,
  Send,
  Trash2,
  Sparkles,
  X,
  Clock,
  Shield,
  Lock,
} from "lucide-react"

interface RecommendationDisplay {
  label: string
  color: string
  bgColor: string
  borderColor: string
}

interface QuickInsights {
  paybackMonths: number
  paybackColor: string
  paybackTextColor: string
  totalRebate: number
  rebatePercentOfTotal: number
  rebateColor: string
  rebateTextColor: string
  capitalRisk: string
  capitalRiskColor: string
  capitalRiskTextColor: string
  contractLength: number
}

interface ScenarioAnalysis {
  totalProposedCost: number
  totalCurrentCost: number
  totalSavings: number
  totalSavingsPercent: number
}

interface ComparisonRow {
  term: string
  current: string
  proposed: string
  delta: string
  favorable: boolean
}

interface FinancialProjectionRow {
  year: number
  cogBaseline: number
  proposedSpend: number
  rebate: number
  netCost: number
  savingsVsCOG: number
}

interface FinancialProjections {
  rows: FinancialProjectionRow[]
  totals: {
    cogBaseline: number
    proposedSpend: number
    rebate: number
    netCost: number
    savingsVsCOG: number
  }
}

interface RadarDataPoint {
  dimension: string
  value: number
  fullMark: number
}

export interface AnalysisOverviewTabProps {
  analysis: ProposalAnalysis
  rec: RecommendationDisplay | null
  quickInsights: QuickInsights | null
  radarData: RadarDataPoint[]
  risks: string[]
  negotiationPoints: string[]
  financialProjections: FinancialProjections | null
  comparisonRows: ComparisonRow[]
  scenarioDiscount: number
  scenarioVolumeIncrease: number
  onScenarioDiscountChange: (value: number) => void
  onScenarioVolumeChange: (value: number) => void
  scenarioAnalysis: ScenarioAnalysis | null
  formatCurrency: (value: number) => string
  manualEntryMinimumSpend: number
  manualEntryMarketShare: number
  onClearAnalysis: () => void
}

export function AnalysisOverviewTab({
  analysis,
  rec,
  quickInsights,
  radarData,
  risks,
  negotiationPoints,
  financialProjections,
  comparisonRows,
  scenarioDiscount,
  scenarioVolumeIncrease,
  onScenarioDiscountChange,
  onScenarioVolumeChange,
  scenarioAnalysis,
  formatCurrency,
  manualEntryMinimumSpend,
  manualEntryMarketShare,
  onClearAnalysis,
}: AnalysisOverviewTabProps) {
  return (
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

      {/* Quick Analysis Insights */}
      {quickInsights && (
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Payback Period */}
          <Card
            className={`border-l-4 ${quickInsights.paybackColor}`}
          >
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Payback Period
                  </p>
                  <p
                    className={`text-2xl font-bold ${quickInsights.paybackTextColor}`}
                  >
                    {quickInsights.paybackMonths === Infinity
                      ? "N/A"
                      : `${quickInsights.paybackMonths} mo`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {quickInsights.paybackMonths < 24
                      ? "Excellent - fast ROI"
                      : quickInsights.paybackMonths <= 48
                        ? "Moderate payback timeline"
                        : "Extended payback period"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Total Rebate Potential */}
          <Card
            className={`border-l-4 ${quickInsights.rebateColor}`}
          >
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <DollarSign className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Total Rebate Potential
                  </p>
                  <p
                    className={`text-2xl font-bold ${quickInsights.rebateTextColor}`}
                  >
                    {formatCurrency(quickInsights.totalRebate)}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {quickInsights.rebatePercentOfTotal.toFixed(1)}% of
                    total contract value over{" "}
                    {quickInsights.contractLength} yr
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Capital Risk Assessment */}
          <Card
            className={`border-l-4 ${quickInsights.capitalRiskColor}`}
          >
            <CardContent className="pt-4">
              <div className="flex items-center gap-3">
                <Shield className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Capital Risk Assessment
                  </p>
                  <p
                    className={`text-2xl font-bold ${quickInsights.capitalRiskTextColor}`}
                  >
                    {quickInsights.capitalRisk}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Rebate rate vs 3% benchmark
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Radar Chart + Score Breakdown */}
      <DealScorePanel
        dealScore={analysis.dealScore}
        radarData={radarData}
        recommendationLabel={rec?.label ?? null}
      />

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

      {/* Year-by-Year Financial Projections */}
      {financialProjections && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Year-by-Year Financial Projections
            </CardTitle>
            <CardDescription>
              Projected costs with 3% COG inflation and 2% proposed
              price increases over {financialProjections.rows.length}{" "}
              year{financialProjections.rows.length !== 1 ? "s" : ""}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead>Year</TableHead>
                    <TableHead className="text-right">
                      COG Baseline (3% infl.)
                    </TableHead>
                    <TableHead className="text-right">
                      Proposed Spend (2% incr.)
                    </TableHead>
                    <TableHead className="text-right">
                      Rebate
                    </TableHead>
                    <TableHead className="text-right">
                      Net Cost
                    </TableHead>
                    <TableHead className="text-right">
                      Savings vs COG
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {financialProjections.rows.map((row) => (
                    <TableRow key={row.year}>
                      <TableCell className="font-medium">
                        Year {row.year}
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {formatCurrency(row.cogBaseline)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(row.proposedSpend)}
                      </TableCell>
                      <TableCell className="text-right text-purple-600 dark:text-purple-400">
                        {formatCurrency(row.rebate)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(row.netCost)}
                      </TableCell>
                      <TableCell
                        className={`text-right font-medium ${
                          row.savingsVsCOG >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        {formatCurrency(row.savingsVsCOG)}
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Totals Row */}
                  <TableRow className="bg-muted/50 font-bold border-t-2">
                    <TableCell>Total</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        financialProjections.totals.cogBaseline
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        financialProjections.totals.proposedSpend
                      )}
                    </TableCell>
                    <TableCell className="text-right text-purple-600 dark:text-purple-400">
                      {formatCurrency(
                        financialProjections.totals.rebate
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(
                        financialProjections.totals.netCost
                      )}
                    </TableCell>
                    <TableCell
                      className={`text-right ${
                        financialProjections.totals.savingsVsCOG >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {formatCurrency(
                        financialProjections.totals.savingsVsCOG
                      )}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Commitment Requirements */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Commitment Requirements
          </CardTitle>
          <CardDescription>
            Key obligations required under this proposal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">
                Minimum Spend
              </p>
              <p className="text-xl font-bold">
                {manualEntryMinimumSpend > 0
                  ? formatCurrency(manualEntryMinimumSpend)
                  : "Not specified"}
              </p>
              {manualEntryMinimumSpend > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Annual commitment required
                </p>
              )}
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">
                Market Share
              </p>
              <p className="text-xl font-bold">
                {manualEntryMarketShare > 0
                  ? `${manualEntryMarketShare}%`
                  : "Not specified"}
              </p>
              {manualEntryMarketShare > 0 && (
                <p className="text-xs text-muted-foreground mt-1">
                  Of category spend to vendor
                </p>
              )}
            </div>
            <div className="p-4 bg-muted/50 rounded-lg">
              <p className="text-sm text-muted-foreground mb-1">
                Exclusivity
              </p>
              <div className="flex items-center gap-2">
                <p className="text-xl font-bold">
                  {manualEntryMarketShare >= 90 ? "Yes" : "No"}
                </p>
                {manualEntryMarketShare >= 90 && (
                  <Badge variant="destructive" className="text-xs">
                    Exclusive
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {manualEntryMarketShare >= 90
                  ? "Sole-source commitment required"
                  : "Non-exclusive arrangement"}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

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
                onValueChange={(v) => onScenarioDiscountChange(v[0])}
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
                  onScenarioVolumeChange(v[0])
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
              onClick={onClearAnalysis}
            >
              <Trash2 className="h-4 w-4" />
              Clear Analysis
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
