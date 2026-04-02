"use client"

import { useState, useMemo, useCallback } from "react"
import { toast } from "sonner"
import {
  Card,
  CardContent,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAnalyzeProposal } from "@/hooks/use-prospective"
import { useCOGStats } from "@/hooks/use-cog"
import type { ProposalAnalysis } from "@/lib/actions/prospective"
import {
  Upload,
  FileText,
  DollarSign,
  Percent,
  BarChart3,
  Download,
  FileSpreadsheet,
  Gauge,
} from "lucide-react"
import { ProposalUploadTab } from "./prospective/proposal-upload-tab"
import { PricingComparisonTab } from "./prospective/pricing-comparison-tab"
import { AnalysisOverviewTab } from "./prospective/analysis-overview-tab"
import { ProposalListTab } from "./prospective/proposal-list-tab"

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
  const analyzeMutation = useAnalyzeProposal()
  const { data: cogStats } = useCOGStats(facilityId)

  const [isDragging, setIsDragging] = useState(false)

  const [manualEntry, setManualEntry] = useState({
    vendorName: "",
    productCategory: "Orthopedics",
    totalValue: 500000,
    contractLength: 3,
    baseDiscount: 0,
    rebatePercent: 0,
    minimumSpend: 0,
    marketShare: 0,
  })

  const [scenarioDiscount, setScenarioDiscount] = useState(5)
  const [scenarioVolumeIncrease, setScenarioVolumeIncrease] = useState(10)

  const rec = analysis?.dealScore
    ? RECOMMENDATION_LABELS[analysis.dealScore.recommendation] ??
      RECOMMENDATION_LABELS.negotiate!
    : null

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

  const quickInsights = useMemo(() => {
    if (!analysis) return null
    const contractLength = manualEntry.contractLength || 3
    const contractTotal = analysis.totalProposedCost * contractLength
    const rebateRate = 0.03
    const yearlyRebate = analysis.totalProposedCost * rebateRate
    const totalRebate = yearlyRebate * contractLength

    const paybackMonths =
      yearlyRebate > 0
        ? Math.round((contractTotal / (yearlyRebate * 12)) * 12)
        : Infinity
    const paybackColor =
      paybackMonths < 24
        ? "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
        : paybackMonths <= 48
          ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
          : "border-l-red-500 bg-red-50/50 dark:bg-red-950/20"
    const paybackTextColor =
      paybackMonths < 24
        ? "text-emerald-700 dark:text-emerald-300"
        : paybackMonths <= 48
          ? "text-amber-700 dark:text-amber-300"
          : "text-red-700 dark:text-red-300"

    const rebatePercentOfTotal =
      contractTotal > 0 ? (totalRebate / contractTotal) * 100 : 0
    const rebateGood = rebatePercentOfTotal > 5
    const rebateColor = rebateGood
      ? "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
      : "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
    const rebateTextColor = rebateGood
      ? "text-emerald-700 dark:text-emerald-300"
      : "text-amber-700 dark:text-amber-300"

    const effectiveRebateRate = rebateRate * 100
    const capitalRisk =
      effectiveRebateRate >= 3
        ? "Low"
        : effectiveRebateRate >= 1.5
          ? "Moderate"
          : "High"
    const capitalRiskColor =
      capitalRisk === "Low"
        ? "border-l-emerald-500 bg-emerald-50/50 dark:bg-emerald-950/20"
        : capitalRisk === "Moderate"
          ? "border-l-amber-500 bg-amber-50/50 dark:bg-amber-950/20"
          : "border-l-red-500 bg-red-50/50 dark:bg-red-950/20"
    const capitalRiskTextColor =
      capitalRisk === "Low"
        ? "text-emerald-700 dark:text-emerald-300"
        : capitalRisk === "Moderate"
          ? "text-amber-700 dark:text-amber-300"
          : "text-red-700 dark:text-red-300"

    return {
      paybackMonths,
      paybackColor,
      paybackTextColor,
      totalRebate,
      rebatePercentOfTotal,
      rebateColor,
      rebateTextColor,
      capitalRisk,
      capitalRiskColor,
      capitalRiskTextColor,
      contractLength,
    }
  }, [analysis, manualEntry.contractLength])

  const financialProjections = useMemo(() => {
    if (!analysis) return null
    const years = manualEntry.contractLength || 3
    const baseline = analysis.totalCurrentCost
    const proposed = analysis.totalProposedCost
    const inflationRate = 0.03
    const proposedIncreaseRate = 0.02
    const rebateRate = 0.03

    const rows = []
    let totalCOG = 0
    let totalProposed = 0
    let totalRebate = 0
    let totalNet = 0
    let totalSavings = 0

    for (let y = 1; y <= years; y++) {
      const cogYear = baseline * Math.pow(1 + inflationRate, y - 1)
      const proposedYear = proposed * Math.pow(1 + proposedIncreaseRate, y - 1)
      const rebateYear = proposedYear * rebateRate
      const netCost = proposedYear - rebateYear
      const savingsVsCOG = cogYear - netCost

      totalCOG += cogYear
      totalProposed += proposedYear
      totalRebate += rebateYear
      totalNet += netCost
      totalSavings += savingsVsCOG

      rows.push({
        year: y,
        cogBaseline: cogYear,
        proposedSpend: proposedYear,
        rebate: rebateYear,
        netCost,
        savingsVsCOG,
      })
    }

    return {
      rows,
      totals: {
        cogBaseline: totalCOG,
        proposedSpend: totalProposed,
        rebate: totalRebate,
        netCost: totalNet,
        savingsVsCOG: totalSavings,
      },
    }
  }, [analysis, manualEntry.contractLength])

  const handleFileUpload = useCallback(
    async (file: File) => {
      const ext = file.name.split(".").pop()?.toLowerCase()
      if (ext === "pdf") {
        toast.error("PDF files are not supported for proposal upload. Please export your pricing data as a CSV file.")
        return
      }
      if (ext !== "csv") {
        toast.error("Please upload a CSV file (.csv)")
        return
      }

      const text = await file.text()
      const lines = text.split("\n").filter((l) => l.trim())
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
      const rawHeaders =
        lines[0]?.split(",").map((h) => h.trim()) ?? []
      const normHeaders = rawHeaders.map(norm)

      const find = (...aliases: string[]) => {
        const idx = aliases.map(norm).reduce<number>(
          (found, a) => (found >= 0 ? found : normHeaders.indexOf(a)),
          -1,
        )
        return idx
      }

      const idxItem = find("item_no", "itemno", "vendor_item_no", "vendoritemno", "sku", "item_number", "itemnumber", "product_ref_number", "productrefnumber")
      const idxDesc = find("description", "desc", "item_description", "product_name", "productname")
      const idxProposed = find("proposed_price", "proposedprice", "price", "unit_price", "unitprice", "new_price", "newprice")
      const idxCurrent = find("current_price", "currentprice", "unit_cost", "unitcost", "cost")
      const idxQty = find("quantity", "qty", "quantity_ordered", "quantityordered")

      const items = lines.slice(1).map((line) => {
        const vals = line.split(",").map((v) => v.trim())
        const g = (idx: number) => (idx >= 0 ? vals[idx] ?? "" : "")
        return {
          vendorItemNo: g(idxItem),
          description: g(idxDesc) || undefined,
          proposedPrice: parseFloat(g(idxProposed).replace(/[^0-9.-]/g, "") || "0"),
          currentPrice:
            parseFloat(g(idxCurrent).replace(/[^0-9.-]/g, "") || "0") || undefined,
          quantity:
            parseInt(g(idxQty) || "1") || undefined,
        }
      }).filter((i) => i.vendorItemNo)

      if (items.length === 0) {
        toast.error("No valid items found in CSV. Check that the file has an item number column (e.g. item_no, sku, vendor_item_no).")
        return
      }

      try {
        const result = await analyzeMutation.mutateAsync({
          facilityId,
          proposedPricing: items,
        })
        setAnalysis(result)
        setActiveTab("analysis")
      } catch {
        // handled by mutation toast
      }
    },
    [facilityId, analyzeMutation]
  )

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const file = e.dataTransfer.files[0]
      if (file) handleFileUpload(file)
    },
    [handleFileUpload]
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    setIsDragging(false)
  }, [])

  const handleClearAnalysis = useCallback(() => {
    setAnalysis(null)
    setActiveTab("upload")
  }, [])

  const handleSelectProposal = useCallback(() => {
    setActiveTab("analysis")
  }, [])

  const formatCurrency = (value: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)

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
              <Gauge className="h-8 w-8 text-muted-foreground/30" />
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

        <TabsContent value="upload" className="space-y-6">
          <ProposalUploadTab
            onFileUpload={handleFileUpload}
            isDragging={isDragging}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            isAnalyzing={analyzeMutation.isPending}
            manualEntry={manualEntry}
            onManualEntryChange={setManualEntry}
          />
        </TabsContent>

        <TabsContent value="pricing" className="space-y-6">
          <PricingComparisonTab
            analysis={analysis}
            cogStats={cogStats}
            formatCurrency={formatCurrency}
            getVarianceColor={getVarianceColor}
            getVarianceBg={getVarianceBg}
            onFileUpload={handleFileUpload}
          />
        </TabsContent>

        <TabsContent value="analysis" className="space-y-6">
          {analysis && (
            <AnalysisOverviewTab
              analysis={analysis}
              rec={rec}
              quickInsights={quickInsights}
              radarData={radarData}
              risks={risks}
              negotiationPoints={negotiationPoints}
              financialProjections={financialProjections}
              comparisonRows={comparisonRows}
              scenarioDiscount={scenarioDiscount}
              scenarioVolumeIncrease={scenarioVolumeIncrease}
              onScenarioDiscountChange={setScenarioDiscount}
              onScenarioVolumeChange={setScenarioVolumeIncrease}
              scenarioAnalysis={scenarioAnalysis}
              formatCurrency={formatCurrency}
              manualEntryMinimumSpend={manualEntry.minimumSpend}
              manualEntryMarketShare={manualEntry.marketShare}
              onClearAnalysis={handleClearAnalysis}
            />
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4">
          {analysis && (
            <ProposalListTab
              analysis={analysis}
              formatCurrency={formatCurrency}
              onSelectProposal={handleSelectProposal}
              onDeleteProposal={handleClearAnalysis}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
