"use client"

import { useState, useMemo } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  usePriceProjections,
  useVendorSpendTrends,
  useCategorySpendTrends,
  useSpendForecast,
  useRebateForecast,
} from "@/hooks/use-analysis"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"
import Link from "next/link"
import { Calculator, Target, Upload, Download, TrendingUp } from "lucide-react"
import { ForecastTable } from "./forecast-table"
import { ForecastChart } from "./forecast-chart"
import { Skeleton } from "@/components/ui/skeleton"

import { UploadTab } from "./capital/upload-tab"
import { ContractInputsTab } from "./capital/contract-inputs-tab"
import { ProjectionsTab } from "./capital/projections-tab"
import { FinancialAnalysisTab } from "./capital/financial-analysis-tab"
import { SummaryReportTab } from "./capital/summary-report-tab"

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
  const [contractTotal, setContractTotal] = useState(0)
  const [contractLength, setContractLength] = useState(0)

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

  const { data: spendForecast, isLoading: spendForecastLoading } =
    useSpendForecast(facilityId, { periods: 6 })
  const { data: rebateForecast, isLoading: rebateForecastLoading } =
    useRebateForecast(facilityId, { periods: 6 })

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
              <TabsTrigger value="forecasts" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Forecasts
              </TabsTrigger>
            </TabsList>

            <TabsContent value="upload" className="space-y-6">
              <UploadTab onExtracted={(data) => {
                if (data.contractTotal) setContractTotal(data.contractTotal)
                if (data.contractLength) setContractLength(data.contractLength)
                if (data.rebatePercent) setRebatePercent(data.rebatePercent)
                setActiveTab("inputs")
              }} />
            </TabsContent>

            <TabsContent value="inputs" className="space-y-6">
              <ContractInputsTab
                contractTotal={contractTotal}
                contractLength={contractLength}
                discountRate={discountRate}
                taxRate={taxRate}
                annualGrowthRate={annualGrowthRate}
                rebatePercent={rebatePercent}
                onContractTotalChange={setContractTotal}
                onContractLengthChange={setContractLength}
                onDiscountRateChange={setDiscountRate}
                onTaxRateChange={setTaxRate}
                onAnnualGrowthRateChange={setAnnualGrowthRate}
                onRebatePercentChange={setRebatePercent}
                onScheduleChange={setSchedule}
              />
            </TabsContent>

            <TabsContent value="projections" className="space-y-6">
              <ProjectionsTab
                schedule={schedule}
                totalCapitalValue={totalCapitalValue}
                avgDepreciationRate={avgDepreciationRate}
                projectedAnnualSpend={projectedAnnualSpend}
                vtLoading={vtLoading}
                projLoading={projLoading}
                projections={projections}
                yearlyProjections={yearlyProjections}
                totalRebate={totalRebate}
                contractLength={contractLength}
                annualGrowthRate={annualGrowthRate}
                formatCurrency={formatCurrency}
              />
            </TabsContent>

            <TabsContent value="analysis" className="space-y-6">
              <FinancialAnalysisTab
                npv={npv}
                irr={irr}
                trueCost={trueCost}
                totalRebate={totalRebate}
                totalTaxSavings={totalTaxSavings}
                contractTotal={contractTotal}
                discountRate={discountRate}
                rebatePercent={rebatePercent}
                contractLength={contractLength}
                taxRate={taxRate}
                depreciationSchedule={depreciationSchedule}
                priceLockCosts={priceLockCosts}
                vendorTrends={vendorTrends}
                catTrends={catTrends}
                vtLoading={vtLoading}
                ctLoading={ctLoading}
                formatCurrency={formatCurrency}
              />
            </TabsContent>

            <TabsContent value="report" className="space-y-6">
              <SummaryReportTab
                contractTotal={contractTotal}
                contractLength={contractLength}
                npv={npv}
                irr={irr}
                discountRate={discountRate}
                totalRebate={totalRebate}
                totalTaxSavings={totalTaxSavings}
                totalPriceLockCost={totalPriceLockCost}
                trueCost={trueCost}
                yearlyProjections={yearlyProjections}
                projections={projections}
                vendorTrends={vendorTrends}
                formatCurrency={formatCurrency}
              />
            </TabsContent>

            <TabsContent value="forecasts" className="space-y-6">
              {spendForecastLoading || rebateForecastLoading ? (
                <div className="space-y-6">
                  <Skeleton className="h-[400px] w-full rounded-lg" />
                  <Skeleton className="h-[300px] w-full rounded-lg" />
                </div>
              ) : (
                <>
                  {spendForecast && (
                    <div className="grid gap-6 lg:grid-cols-2">
                      <ForecastChart
                        result={spendForecast}
                        title="Spend Forecast"
                        description="Historical spend with projected trend and confidence interval"
                      />
                      <ForecastTable
                        result={spendForecast}
                        label="Spend"
                      />
                    </div>
                  )}
                  {rebateForecast && (
                    <div className="grid gap-6 lg:grid-cols-2">
                      <ForecastChart
                        result={rebateForecast}
                        title="Rebate Forecast"
                        description="Historical rebates with projected trend and confidence interval"
                      />
                      <ForecastTable
                        result={rebateForecast}
                        label="Rebate"
                      />
                    </div>
                  )}
                </>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}
