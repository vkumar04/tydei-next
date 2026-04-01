"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  usePriceProjections,
  useVendorSpendTrends,
  useCategorySpendTrends,
} from "@/hooks/use-analysis"
import { DepreciationCalculator } from "./depreciation-calculator"
import { DepreciationChart } from "./depreciation-chart"
import { PriceProjectionChart } from "./price-projection-chart"
import { SpendTrendChart } from "./spend-trend-chart"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"
import Link from "next/link"
import {
  Calculator,
  Target,
  Upload,
  Download,
  DollarSign,
  Percent,
  TrendingUp,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react"

interface AnalysisClientProps {
  facilityId: string
}

export function AnalysisClient({ facilityId }: AnalysisClientProps) {
  const [schedule, setSchedule] = useState<DepreciationSchedule | null>(null)
  const [analysisType, setAnalysisType] = useState<"capital" | "prospective">(
    "capital"
  )
  const [activeTab, setActiveTab] = useState("upload")

  // Financial assumption state
  const [discountRate, setDiscountRate] = useState(7)
  const [taxRate, setTaxRate] = useState(21)
  const [annualGrowthRate, setAnnualGrowthRate] = useState(3)
  const [rebatePercent, setRebatePercent] = useState(3)
  const [contractTotal, setContractTotal] = useState(500000)
  const [contractLength, setContractLength] = useState(5)

  const dateRange = useMemo(() => {
    const now = new Date()
    const from = new Date(now)
    from.setMonth(now.getMonth() - 6)
    return {
      from: from.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    }
  }, [])

  const { data: projections, isLoading: projLoading } = usePriceProjections(
    facilityId,
    { periods: 12 }
  )
  const { data: vendorTrends, isLoading: vtLoading } = useVendorSpendTrends(
    facilityId,
    dateRange
  )
  const { data: catTrends, isLoading: ctLoading } = useCategorySpendTrends(
    facilityId,
    dateRange
  )

  const totalCapitalValue = useMemo(() => {
    if (!schedule) return 0
    return schedule.assetCost
  }, [schedule])

  const avgDepreciationRate = useMemo(() => {
    if (!schedule || schedule.years.length === 0) return 0
    const totalRate = schedule.years.reduce((s, y) => s + y.rate, 0)
    return Math.round((totalRate / schedule.years.length) * 100) / 100
  }, [schedule])

  const projectedAnnualSpend = useMemo(() => {
    if (!vendorTrends || vendorTrends.length === 0) return 0
    const totalSpend = vendorTrends.reduce((s, t) => s + t.spend, 0)
    const months = new Set(vendorTrends.map((t) => t.month)).size
    if (months === 0) return 0
    return Math.round((totalSpend / months) * 12)
  }, [vendorTrends])

  // --- Yearly Projections ---
  const yearlyProjections = useMemo(() => {
    const years = []
    for (let i = 1; i <= contractLength; i++) {
      const spend =
        (contractTotal / contractLength) *
        Math.pow(1 + annualGrowthRate / 100, i - 1)
      const revenue = spend * 1.1
      const rebate = (spend * rebatePercent) / 100
      const netCashFlow = revenue - spend + rebate
      years.push({ year: i, spend, revenue, rebate, netCashFlow })
    }
    return years
  }, [contractTotal, contractLength, annualGrowthRate, rebatePercent])

  // --- MACRS Depreciation ---
  const macrsRates = [20, 32, 19.2, 11.52, 11.52, 5.76]
  const depreciationSchedule = useMemo(() => {
    let accumulated = 0
    return macrsRates.map((rate, i) => {
      const depreciation = (contractTotal * rate) / 100
      const taxSavings = (depreciation * taxRate) / 100
      accumulated += depreciation
      return { year: i + 1, rate, depreciation, taxSavings, accumulated }
    })
  }, [contractTotal, taxRate])

  // --- NPV ---
  const npv = useMemo(() => {
    let value = -contractTotal
    for (const year of yearlyProjections) {
      const cashFlow =
        year.netCashFlow +
        (depreciationSchedule[year.year - 1]?.taxSavings ?? 0)
      value += cashFlow / Math.pow(1 + discountRate / 100, year.year)
    }
    return value
  }, [contractTotal, yearlyProjections, depreciationSchedule, discountRate])

  // --- IRR (bisection method) ---
  const irr = useMemo(() => {
    const cashFlows = [
      -contractTotal,
      ...yearlyProjections.map(
        (y, i) => y.netCashFlow + (depreciationSchedule[i]?.taxSavings ?? 0)
      ),
    ]
    let low = -0.5,
      high = 2.0
    for (let iter = 0; iter < 100; iter++) {
      const mid = (low + high) / 2
      const npvAtMid = cashFlows.reduce(
        (sum, cf, t) => sum + cf / Math.pow(1 + mid, t),
        0
      )
      if (Math.abs(npvAtMid) < 0.01) return mid * 100
      if (npvAtMid > 0) low = mid
      else high = mid
    }
    return ((low + high) / 2) * 100
  }, [contractTotal, yearlyProjections, depreciationSchedule])

  // --- Price Lock Cost ---
  const priceLockCosts = useMemo(() => {
    const annualCost = contractTotal / contractLength
    let totalExtraCost = 0
    return Array.from({ length: contractLength }, (_, i) => {
      const yourPrice = annualCost
      const marketPrice = annualCost * Math.pow(0.98, i + 1)
      const extraCost = yourPrice - marketPrice
      totalExtraCost += extraCost
      return { year: i + 1, yourPrice, marketPrice, extraCost, totalExtraCost }
    })
  }, [contractTotal, contractLength])

  // --- Derived totals ---
  const totalRebate = useMemo(
    () => yearlyProjections.reduce((s, y) => s + y.rebate, 0),
    [yearlyProjections]
  )
  const totalTaxSavings = useMemo(
    () => depreciationSchedule.reduce((s, d) => s + d.taxSavings, 0),
    [depreciationSchedule]
  )
  const totalPriceLockCost =
    priceLockCosts[priceLockCosts.length - 1]?.totalExtraCost ?? 0
  const trueCost = contractTotal + totalPriceLockCost - totalRebate - totalTaxSavings

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-balance">
            Contract Analysis
          </h1>
          <p className="text-muted-foreground">
            Evaluate contracts with financial projections, composite scoring, and
            ROI analysis
          </p>
        </div>
      </div>

      {/* Analysis Type Toggle */}
      <div className="flex gap-2">
        <Button
          variant={analysisType === "capital" ? "default" : "outline"}
          className="gap-2"
          onClick={() => setAnalysisType("capital")}
        >
          <Calculator className="h-4 w-4" />
          Capital Contract Analysis
        </Button>
        <Link href="/dashboard/analysis/prospective">
          <Button
            variant={analysisType === "prospective" ? "default" : "outline"}
            className="gap-2"
            onClick={() => setAnalysisType("prospective")}
          >
            <Target className="h-4 w-4" />
            Prospective Contract Analysis
          </Button>
        </Link>
      </div>

      {analysisType === "capital" && (
        <>
          {/* Capital Analysis Section Header */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-semibold">
                Capital Contract Analysis
              </h2>
              <p className="text-sm text-muted-foreground">
                Evaluate NPV, IRR, and true cost of capital contracts with
                rebate projections
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline">
                <Download className="mr-2 h-4 w-4" />
                Export Report
              </Button>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={setActiveTab}
            className="space-y-6"
          >
            <TabsList>
              <TabsTrigger value="upload" className="gap-2">
                <Upload className="h-4 w-4" />
                Upload Contract
              </TabsTrigger>
              <TabsTrigger value="inputs">Contract Inputs</TabsTrigger>
              <TabsTrigger value="projections">Yearly Projections</TabsTrigger>
              <TabsTrigger value="analysis">Financial Analysis</TabsTrigger>
              <TabsTrigger value="report">Summary Report</TabsTrigger>
            </TabsList>

            {/* Upload Contract Tab */}
            <TabsContent value="upload" className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle>Upload Capital Contract</CardTitle>
                  <CardDescription>
                    Upload a capital contract PDF to automatically extract and
                    analyze financial terms
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="border-2 border-dashed rounded-lg p-8 text-center border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer">
                    <div className="space-y-3">
                      <div className="flex justify-center">
                        <Upload className="h-10 w-10 text-muted-foreground" />
                      </div>
                      <p className="font-medium">
                        Drag &amp; drop a capital contract PDF
                      </p>
                      <p className="text-sm text-muted-foreground">
                        or click to browse files
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Contract Inputs Tab */}
            <TabsContent value="inputs" className="space-y-6">
              <DepreciationCalculator onScheduleChange={setSchedule} />

              {/* Financial Assumptions */}
              <Card>
                <CardHeader>
                  <CardTitle>Financial Assumptions</CardTitle>
                  <CardDescription>
                    Configure parameters used across projections and financial
                    analysis
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="contractTotal">Contract Total ($)</Label>
                      <Input
                        id="contractTotal"
                        type="number"
                        value={contractTotal}
                        onChange={(e) =>
                          setContractTotal(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="contractLength">
                        Contract Length (years)
                      </Label>
                      <Input
                        id="contractLength"
                        type="number"
                        min={1}
                        max={30}
                        value={contractLength}
                        onChange={(e) =>
                          setContractLength(Number(e.target.value) || 1)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="discountRate">Discount Rate (%)</Label>
                      <Input
                        id="discountRate"
                        type="number"
                        step={0.5}
                        value={discountRate}
                        onChange={(e) =>
                          setDiscountRate(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="taxRate">Tax Rate (%)</Label>
                      <Input
                        id="taxRate"
                        type="number"
                        step={0.5}
                        value={taxRate}
                        onChange={(e) =>
                          setTaxRate(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="annualGrowthRate">
                        Annual Growth Rate (%)
                      </Label>
                      <Input
                        id="annualGrowthRate"
                        type="number"
                        step={0.5}
                        value={annualGrowthRate}
                        onChange={(e) =>
                          setAnnualGrowthRate(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="rebatePercent">Rebate (%)</Label>
                      <Input
                        id="rebatePercent"
                        type="number"
                        step={0.5}
                        value={rebatePercent}
                        onChange={(e) =>
                          setRebatePercent(Number(e.target.value) || 0)
                        }
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            {/* Yearly Projections Tab */}
            <TabsContent value="projections" className="space-y-6">
              {/* Stat Cards */}
              <div className="grid gap-4 sm:grid-cols-3">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Total Capital Value
                        </p>
                        <p className="text-2xl font-bold">
                          {schedule
                            ? formatCurrency(totalCapitalValue)
                            : "--"}
                        </p>
                        {schedule && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {schedule.recoveryPeriod}-year MACRS
                          </p>
                        )}
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
                          Average Depreciation Rate
                        </p>
                        <p className="text-2xl font-bold">
                          {schedule ? `${avgDepreciationRate}%` : "--"}
                        </p>
                        {schedule && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Per year (
                            {schedule.convention.replace("_", " ")})
                          </p>
                        )}
                      </div>
                      <Percent className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-emerald-500">
                  <CardContent className="pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Projected Annual Spend
                        </p>
                        <p className="text-2xl font-bold">
                          {vtLoading
                            ? "--"
                            : formatCurrency(projectedAnnualSpend)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Annualized from trend data
                        </p>
                      </div>
                      <TrendingUp className="h-8 w-8 text-muted-foreground/30" />
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* Yearly Projections Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Yearly Cash Flow Projections</CardTitle>
                  <CardDescription>
                    Projected spend, revenue, rebate, and net cash flow over the
                    {contractLength}-year contract at {annualGrowthRate}% annual
                    growth
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Year</TableHead>
                        <TableHead className="text-right">
                          Projected Spend
                        </TableHead>
                        <TableHead className="text-right">
                          Projected Revenue
                        </TableHead>
                        <TableHead className="text-right">
                          Projected Rebate
                        </TableHead>
                        <TableHead className="text-right">
                          Net Cash Flow
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {yearlyProjections.map((row) => (
                        <TableRow key={row.year}>
                          <TableCell className="font-medium">
                            Year {row.year}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.spend).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.revenue).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.rebate).toLocaleString()}
                          </TableCell>
                          <TableCell
                            className={`text-right font-medium ${
                              row.netCashFlow >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-red-600 dark:text-red-400"
                            }`}
                          >
                            ${Math.round(row.netCashFlow).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Totals row */}
                      <TableRow className="font-bold border-t-2">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">
                          $
                          {Math.round(
                            yearlyProjections.reduce((s, y) => s + y.spend, 0)
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          $
                          {Math.round(
                            yearlyProjections.reduce(
                              (s, y) => s + y.revenue,
                              0
                            )
                          ).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Math.round(totalRebate).toLocaleString()}
                        </TableCell>
                        <TableCell
                          className={`text-right ${
                            yearlyProjections.reduce(
                              (s, y) => s + y.netCashFlow,
                              0
                            ) >= 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          $
                          {Math.round(
                            yearlyProjections.reduce(
                              (s, y) => s + y.netCashFlow,
                              0
                            )
                          ).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {schedule && <DepreciationChart schedule={schedule} />}

              {projLoading ? (
                <Skeleton className="h-[340px] rounded-xl" />
              ) : (
                <PriceProjectionChart projections={projections ?? []} />
              )}
            </TabsContent>

            {/* Financial Analysis Tab */}
            <TabsContent value="analysis" className="space-y-6">
              {/* Summary Metric Cards */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Card className="border-l-4 border-l-blue-500">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">
                      Net Present Value (NPV)
                    </p>
                    <p
                      className={`text-2xl font-bold ${
                        npv >= 0
                          ? "text-emerald-600 dark:text-emerald-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      ${Math.round(npv).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      At {discountRate}% discount rate
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-amber-500">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">
                      Internal Rate of Return (IRR)
                    </p>
                    <p className="text-2xl font-bold">{irr.toFixed(1)}%</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {irr > discountRate
                        ? "Exceeds discount rate"
                        : "Below discount rate"}
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-purple-500">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">
                      True Cost of Capital
                    </p>
                    <p className="text-2xl font-bold">
                      ${Math.round(trueCost).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      After rebates &amp; tax savings
                    </p>
                  </CardContent>
                </Card>

                <Card className="border-l-4 border-l-emerald-500">
                  <CardContent className="pt-4">
                    <p className="text-sm text-muted-foreground">
                      Total Projected Rebate
                    </p>
                    <p className="text-2xl font-bold">
                      ${Math.round(totalRebate).toLocaleString()}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {rebatePercent}% over {contractLength} years
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* MACRS Depreciation Table */}
              <Card>
                <CardHeader>
                  <CardTitle>MACRS Depreciation Schedule</CardTitle>
                  <CardDescription>
                    5-year Modified Accelerated Cost Recovery System at{" "}
                    {taxRate}% tax rate
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Year</TableHead>
                        <TableHead className="text-right">
                          MACRS Rate
                        </TableHead>
                        <TableHead className="text-right">
                          Depreciation Amount
                        </TableHead>
                        <TableHead className="text-right">
                          Tax Savings
                        </TableHead>
                        <TableHead className="text-right">
                          Accumulated Depreciation
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {depreciationSchedule.map((row) => (
                        <TableRow key={row.year}>
                          <TableCell className="font-medium">
                            Year {row.year}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.rate.toFixed(1)}%
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.depreciation).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                            ${Math.round(row.taxSavings).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.accumulated).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                      <TableRow className="font-bold border-t-2">
                        <TableCell>Total</TableCell>
                        <TableCell className="text-right">100.0%</TableCell>
                        <TableCell className="text-right">
                          ${Math.round(contractTotal).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                          ${Math.round(totalTaxSavings).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          ${Math.round(contractTotal).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Price Lock Cost Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Price Lock Cost Analysis</CardTitle>
                  <CardDescription>
                    Opportunity cost of locked-in pricing vs declining market
                    prices (2% annual decrease)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Year</TableHead>
                        <TableHead className="text-right">
                          Your Price (Locked)
                        </TableHead>
                        <TableHead className="text-right">
                          Market Price
                        </TableHead>
                        <TableHead className="text-right">
                          Extra Cost
                        </TableHead>
                        <TableHead className="text-right">
                          Cumulative Extra Cost
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {priceLockCosts.map((row) => (
                        <TableRow key={row.year}>
                          <TableCell className="font-medium">
                            Year {row.year}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.yourPrice).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right">
                            ${Math.round(row.marketPrice).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-red-600 dark:text-red-400">
                            ${Math.round(row.extraCost).toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-red-600 dark:text-red-400">
                            $
                            {Math.round(row.totalExtraCost).toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {/* Existing Spend Trend Charts */}
              {vtLoading ? (
                <Skeleton className="h-[380px] rounded-xl" />
              ) : (
                <SpendTrendChart
                  data={vendorTrends ?? []}
                  groupBy="vendor"
                />
              )}

              {ctLoading ? (
                <Skeleton className="h-[380px] rounded-xl" />
              ) : (
                <>
                  <SpendTrendChart
                    data={catTrends ?? []}
                    groupBy="category"
                  />

                  {catTrends && catTrends.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">
                          Category Breakdown
                        </CardTitle>
                        <CardDescription>
                          Spend distribution across product categories
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {(() => {
                            const catTotals = new Map<string, number>()
                            for (const item of catTrends) {
                              const name = item.categoryName ?? "Other"
                              catTotals.set(
                                name,
                                (catTotals.get(name) ?? 0) + item.spend
                              )
                            }
                            const sorted = Array.from(catTotals.entries())
                              .sort((a, b) => b[1] - a[1])
                              .slice(0, 6)
                            const grandTotal = sorted.reduce(
                              (s, [, v]) => s + v,
                              0
                            )
                            return sorted.map(([name, spend]) => {
                              const pct =
                                grandTotal > 0
                                  ? Math.round((spend / grandTotal) * 100)
                                  : 0
                              return (
                                <div key={name} className="space-y-1">
                                  <div className="flex justify-between text-sm">
                                    <span className="font-medium">
                                      {name}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {formatCurrency(spend)} ({pct}%)
                                    </span>
                                  </div>
                                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-primary transition-all"
                                      style={{ width: `${pct}%` }}
                                    />
                                  </div>
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </CardContent>
                    </Card>
                  )}
                </>
              )}
            </TabsContent>

            {/* Summary Report Tab */}
            <TabsContent value="report" className="space-y-6">
              {/* Contract Summary */}
              <Card>
                <CardHeader>
                  <CardTitle>Contract Summary</CardTitle>
                  <CardDescription>
                    Overview of the capital contract terms
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg bg-muted/50 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Contract Total
                      </p>
                      <p className="text-xl font-bold">
                        ${Math.round(contractTotal).toLocaleString()}
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Contract Length
                      </p>
                      <p className="text-xl font-bold">
                        {contractLength} Years
                      </p>
                    </div>
                    <div className="rounded-lg bg-muted/50 p-4 text-center">
                      <p className="text-sm text-muted-foreground">
                        Annual Payment
                      </p>
                      <p className="text-xl font-bold">
                        $
                        {Math.round(
                          contractTotal / contractLength
                        ).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Key Financial Metrics */}
              <Card>
                <CardHeader>
                  <CardTitle>Key Financial Metrics</CardTitle>
                  <CardDescription>
                    Comprehensive financial analysis results
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <div className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Net Present Value
                      </p>
                      <p
                        className={`text-lg font-bold ${
                          npv >= 0
                            ? "text-emerald-600 dark:text-emerald-400"
                            : "text-red-600 dark:text-red-400"
                        }`}
                      >
                        ${Math.round(npv).toLocaleString()}
                      </p>
                    </div>
                    <div className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Internal Rate of Return
                      </p>
                      <p className="text-lg font-bold">{irr.toFixed(1)}%</p>
                    </div>
                    <div className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Discount Rate
                      </p>
                      <p className="text-lg font-bold">
                        {discountRate.toFixed(1)}%
                      </p>
                    </div>
                    <div className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Total Projected Spend
                      </p>
                      <p className="text-lg font-bold">
                        $
                        {Math.round(
                          yearlyProjections.reduce((s, y) => s + y.spend, 0)
                        ).toLocaleString()}
                      </p>
                    </div>
                    <div className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Total Rebate
                      </p>
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        ${Math.round(totalRebate).toLocaleString()}
                      </p>
                    </div>
                    <div className="space-y-1 rounded-lg border p-4">
                      <p className="text-sm text-muted-foreground">
                        Total Tax Savings
                      </p>
                      <p className="text-lg font-bold text-emerald-600 dark:text-emerald-400">
                        ${Math.round(totalTaxSavings).toLocaleString()}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* True Cost Formula */}
              <Card>
                <CardHeader>
                  <CardTitle>True Cost of Capital</CardTitle>
                  <CardDescription>
                    Net cost accounting for all financial factors
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg bg-muted/50 p-6">
                    <div className="flex flex-wrap items-center justify-center gap-2 text-sm sm:text-base">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          Contract Total
                        </p>
                        <p className="font-bold">
                          ${Math.round(contractTotal).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xl font-bold text-muted-foreground">
                        +
                      </span>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          Price Lock Cost
                        </p>
                        <p className="font-bold text-red-600 dark:text-red-400">
                          $
                          {Math.round(totalPriceLockCost).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xl font-bold text-muted-foreground">
                        -
                      </span>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          Rebates
                        </p>
                        <p className="font-bold text-emerald-600 dark:text-emerald-400">
                          ${Math.round(totalRebate).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xl font-bold text-muted-foreground">
                        -
                      </span>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          Tax Savings
                        </p>
                        <p className="font-bold text-emerald-600 dark:text-emerald-400">
                          ${Math.round(totalTaxSavings).toLocaleString()}
                        </p>
                      </div>
                      <span className="text-xl font-bold text-muted-foreground">
                        =
                      </span>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">
                          True Cost
                        </p>
                        <p className="text-lg font-bold">
                          ${Math.round(trueCost).toLocaleString()}
                        </p>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Recommendation */}
              <Card
                className={`border-l-4 ${
                  npv >= 0 && irr > discountRate
                    ? "border-l-emerald-500"
                    : "border-l-amber-500"
                }`}
              >
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    {npv >= 0 && irr > discountRate ? (
                      <>
                        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                        Recommendation: Favorable
                      </>
                    ) : (
                      <>
                        <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                        Recommendation: Requires Further Consideration
                      </>
                    )}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {npv >= 0 && irr > discountRate ? (
                    <p className="text-muted-foreground">
                      This contract shows a positive NPV of{" "}
                      <span className="font-medium text-foreground">
                        ${Math.round(npv).toLocaleString()}
                      </span>{" "}
                      and an IRR of{" "}
                      <span className="font-medium text-foreground">
                        {irr.toFixed(1)}%
                      </span>{" "}
                      which exceeds the discount rate of{" "}
                      <span className="font-medium text-foreground">
                        {discountRate.toFixed(1)}%
                      </span>
                      . The contract is projected to generate value above the
                      required rate of return, making it a financially favorable
                      investment. Total rebates of{" "}
                      <span className="font-medium text-foreground">
                        ${Math.round(totalRebate).toLocaleString()}
                      </span>{" "}
                      and tax savings of{" "}
                      <span className="font-medium text-foreground">
                        ${Math.round(totalTaxSavings).toLocaleString()}
                      </span>{" "}
                      further reduce the effective cost.
                    </p>
                  ) : (
                    <p className="text-muted-foreground">
                      This contract shows an NPV of{" "}
                      <span className="font-medium text-foreground">
                        ${Math.round(npv).toLocaleString()}
                      </span>{" "}
                      and an IRR of{" "}
                      <span className="font-medium text-foreground">
                        {irr.toFixed(1)}%
                      </span>
                      .{" "}
                      {npv < 0
                        ? "The negative NPV suggests the contract may not generate sufficient returns to justify the investment at the current discount rate. "
                        : ""}
                      {irr <= discountRate
                        ? `The IRR does not exceed the discount rate of ${discountRate.toFixed(1)}%, indicating the return may be below the required threshold. `
                        : ""}
                      Consider negotiating better terms, increasing the rebate
                      percentage, or reducing the contract total to improve the
                      financial profile.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Existing projection details preserved below */}
              {projections && projections.length > 0 && (
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">
                      Projection Details
                    </CardTitle>
                    <CardDescription>
                      Monthly projected price changes over the next{" "}
                      {projections.length} periods
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Current Avg Price
                        </p>
                        <p className="text-xl font-bold">
                          $
                          {projections[0]?.currentPrice.toFixed(2) ?? "0.00"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Projected End Price
                        </p>
                        <p className="text-xl font-bold">
                          $
                          {projections[
                            projections.length - 1
                          ]?.projectedPrice.toFixed(2) ?? "0.00"}
                        </p>
                      </div>
                      <div className="rounded-lg bg-muted/50 p-4 text-center">
                        <p className="text-sm text-muted-foreground">
                          Total Change
                        </p>
                        <p
                          className={`text-xl font-bold ${
                            (projections[projections.length - 1]
                              ?.changePercent ?? 0) < 0
                              ? "text-emerald-600 dark:text-emerald-400"
                              : "text-red-600 dark:text-red-400"
                          }`}
                        >
                          {(
                            projections[projections.length - 1]
                              ?.changePercent ?? 0
                          ).toFixed(1)}
                          %
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Vendor Summary Cards */}
              {vendorTrends && vendorTrends.length > 0 && (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {(() => {
                    const vendorTotals = new Map<string, number>()
                    for (const item of vendorTrends) {
                      const name = item.vendorName ?? "Unknown"
                      vendorTotals.set(
                        name,
                        (vendorTotals.get(name) ?? 0) + item.spend
                      )
                    }
                    return Array.from(vendorTotals.entries())
                      .sort((a, b) => b[1] - a[1])
                      .slice(0, 6)
                      .map(([name, spend]) => (
                        <Card key={name}>
                          <CardContent className="pt-4">
                            <p className="text-sm font-medium truncate">
                              {name}
                            </p>
                            <p className="text-xl font-bold mt-1">
                              {formatCurrency(spend)}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              {
                                vendorTrends.filter(
                                  (t) => t.vendorName === name
                                ).length
                              }{" "}
                              months of data
                            </p>
                          </CardContent>
                        </Card>
                      ))
                  })()}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
