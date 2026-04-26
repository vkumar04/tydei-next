"use client"

import { useMemo, useState } from "react"
import {
  BarChart3,
  CheckCircle2,
  DollarSign,
  TrendingUp,
} from "lucide-react"
import { toast } from "sonner"
import { VendorReportsHero } from "@/components/vendor/reports/reports-hero"
import { VendorReportsControlBar } from "@/components/vendor/reports/reports-control-bar"
import { ReportTypeGrid } from "@/components/vendor/reports/report-type-grid"
import { RecentReportsTable } from "@/components/vendor/reports/recent-reports-table"
import { GenerateReportDialog } from "@/components/vendor/reports/generate-report-dialog"
import { VendorPurchaseLeakageCard } from "@/components/vendor/reports/vendor-purchase-leakage-card"
import type {
  RecentReport,
  ReportType,
  ReportTypeId,
} from "@/components/vendor/reports/reports-types"

/**
 * Vendor Reports hub ("hero + tabs" pattern).
 *
 *   1. Hero KPIs: Generated (MTD) · Scheduled · Last Sent · Facilities Reached
 *   2. ControlBar: facility select, search, category chip group, "New Report"
 *   3. ReportTypeGrid (filtered by category)
 *   4. RecentReportsTable (filtered by category + search)
 *
 * Reference: components/facility/reports/* for the facility-side twin.
 * Data is currently static v0 sample content until server-action wiring
 * lands for the vendor side.
 */

const reportTypes: ReportType[] = [
  {
    id: "performance",
    name: "Performance Summary",
    description: "Contract performance metrics and compliance",
    icon: TrendingUp,
    frequency: "Monthly",
  },
  {
    id: "rebates",
    name: "Rebate Statement",
    description: "Rebates earned and paid by contract",
    icon: DollarSign,
    frequency: "Quarterly",
  },
  {
    id: "spend",
    name: "Spend Analysis",
    description: "Spend breakdown by facility and category",
    icon: BarChart3,
    frequency: "Monthly",
  },
  {
    id: "compliance",
    name: "Compliance Report",
    description: "Contract compliance and tier achievement",
    icon: CheckCircle2,
    frequency: "Quarterly",
  },
]

const defaultRecentReports: RecentReport[] = [
  { id: "1", name: "Q1 2024 Performance Summary", type: "performance", date: "2024-04-05", status: "ready", size: "2.4 MB" },
  { id: "2", name: "Q1 2024 Rebate Statement", type: "rebates", date: "2024-04-02", status: "ready", size: "1.8 MB" },
  { id: "3", name: "March 2024 Spend Analysis", type: "spend", date: "2024-04-01", status: "ready", size: "3.1 MB" },
  { id: "4", name: "February 2024 Spend Analysis", type: "spend", date: "2024-03-01", status: "ready", size: "2.9 MB" },
  { id: "5", name: "Q4 2023 Compliance Report", type: "compliance", date: "2024-01-15", status: "ready", size: "1.5 MB" },
]

interface VendorReportsClientProps {
  // vendorId is accepted for future server-action integration but is not
  // currently consumed — v0 parity renders static sample data.
  vendorId: string
}

export function VendorReportsClient(_props: VendorReportsClientProps) {
  const [selectedFacility, setSelectedFacility] = useState("all")
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false)
  const [selectedReportType, setSelectedReportType] = useState<ReportType | null>(null)
  const [isGenerating, setIsGenerating] = useState(false)
  const [generateProgress, setGenerateProgress] = useState(0)
  const [reportPeriod, setReportPeriod] = useState("current")
  const [generatedReports, setGeneratedReports] = useState<RecentReport[]>(defaultRecentReports)
  const [category, setCategory] = useState<"all" | ReportTypeId>("all")
  const [searchQuery, setSearchQuery] = useState("")

  const handleGenerateReport = (report: ReportType) => {
    setSelectedReportType(report)
    setIsGenerateDialogOpen(true)
  }

  const handleDownload = (report: RecentReport) => {
    toast.success("Download started", {
      description: `Downloading ${report.name}...`,
    })
  }

  const startGenerating = () => {
    setIsGenerating(true)
    setGenerateProgress(0)

    const interval = setInterval(() => {
      setGenerateProgress((prev) => {
        if (prev >= 100) {
          clearInterval(interval)
          return 100
        }
        return prev + Math.random() * 15
      })
    }, 200)

    setTimeout(() => {
      clearInterval(interval)
      setGenerateProgress(100)

      setTimeout(() => {
        const newReport: RecentReport = {
          id: `new-${Date.now()}`,
          name: `${selectedReportType?.name} - ${new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
          type: selectedReportType?.id ?? "performance",
          date: new Date().toISOString().split("T")[0],
          status: "ready",
          size: `${(Math.random() * 3 + 1).toFixed(1)} MB`,
        }
        setGeneratedReports((prev) => [newReport, ...prev])
        setIsGenerating(false)
        setIsGenerateDialogOpen(false)
        setGenerateProgress(0)
        toast.success("Report generated successfully", {
          description: `${newReport.name} is ready for download`,
          action: {
            label: "Download",
            onClick: () => handleDownload(newReport),
          },
        })
      }, 500)
    }, 2000)
  }

  const heroStats = useMemo(() => {
    const now = new Date()
    const year = now.getFullYear()
    const month = now.getMonth()
    const generatedThisMonth = generatedReports.filter((r) => {
      const d = new Date(r.date)
      return d.getFullYear() === year && d.getMonth() === month
    }).length
    const sorted = [...generatedReports].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
    )
    return {
      generatedThisMonth,
      scheduledCount: reportTypes.length,
      lastSentAt: sorted[0]?.date ?? null,
      facilitiesReached: 3,
    }
  }, [generatedReports])

  const filteredReports = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return generatedReports.filter((r) => {
      if (category !== "all" && r.type !== category) return false
      if (q && !r.name.toLowerCase().includes(q)) return false
      return true
    })
  }, [generatedReports, category, searchQuery])

  const visibleReportTypes = useMemo(
    () =>
      category === "all"
        ? reportTypes
        : reportTypes.filter((rt) => rt.id === category),
    [category],
  )

  return (
    <div className="flex flex-col gap-6">
      <VendorReportsHero
        generatedThisMonth={heroStats.generatedThisMonth}
        scheduledCount={heroStats.scheduledCount}
        lastSentAt={heroStats.lastSentAt}
        facilitiesReached={heroStats.facilitiesReached}
      />

      <VendorReportsControlBar
        selectedFacility={selectedFacility}
        onFacilityChange={setSelectedFacility}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        category={category}
        onCategoryChange={setCategory}
        reportTypes={reportTypes}
        onNewReport={() => {
          const first =
            category !== "all"
              ? reportTypes.find((rt) => rt.id === category) ?? reportTypes[0]
              : reportTypes[0]
          handleGenerateReport(first)
        }}
      />

      <ReportTypeGrid
        reportTypes={visibleReportTypes}
        onGenerate={handleGenerateReport}
      />

      <RecentReportsTable
        reports={filteredReports}
        reportTypes={reportTypes}
        category={category}
        onDownload={handleDownload}
      />

      {/* v0-port: vendor-side leakage audit (off-contract /
          out-of-period / price-variance purchases of this vendor's
          product). */}
      <VendorPurchaseLeakageCard />

      <GenerateReportDialog
        open={isGenerateDialogOpen}
        onOpenChange={(open) => {
          if (!isGenerating) {
            setIsGenerateDialogOpen(open)
          }
        }}
        reportType={selectedReportType}
        isGenerating={isGenerating}
        progress={generateProgress}
        reportPeriod={reportPeriod}
        onReportPeriodChange={setReportPeriod}
        selectedFacility={selectedFacility}
        onSelectedFacilityChange={setSelectedFacility}
        onConfirm={startGenerating}
        onCancel={() => setIsGenerateDialogOpen(false)}
      />
    </div>
  )
}
