"use client"

import { useMemo, useState } from "react"
import {
  AlertTriangle,
  ClipboardList,
  DollarSign,
  TrendingUp,
} from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { toast } from "sonner"
import { VendorReportsHero } from "@/components/vendor/reports/reports-hero"
import { VendorReportsControlBar } from "@/components/vendor/reports/reports-control-bar"
import { ReportTypeGrid } from "@/components/vendor/reports/report-type-grid"
import { RecentReportsTable } from "@/components/vendor/reports/recent-reports-table"
import { VendorPurchaseLeakageCard } from "@/components/vendor/reports/vendor-purchase-leakage-card"
import {
  getVendorRebateStatement,
  getVendorPerformanceSummary,
  getVendorContractRoster,
} from "@/lib/actions/vendor-reports"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import {
  formatExportDate,
  formatExportDollars,
  formatExportPercent,
} from "@/lib/reports/export-formatters"
import type {
  RecentReport,
  ReportType,
  ReportTypeId,
} from "@/components/vendor/reports/reports-types"

/**
 * Vendor Reports hub.
 *
 * Cards (4):
 *   1. Rebate Statement     — getVendorRebateStatement(start, end) → CSV
 *   2. Performance Summary  — getVendorPerformanceSummary(start, end) → CSV
 *   3. Contract Roster      — getVendorContractRoster() → CSV
 *   4. Purchase Leakage     — anchor scroll to the existing leakage
 *      card below (the real audit lives there with its own date range).
 *
 * Each generate-button immediately fetches via a TanStack mutation +
 * downloads a CSV using the canonical `toCSV` + `buildReportFilename`
 * helpers (same pattern as the price-discrepancy export, commit
 * 3a872c6). On success, the report is appended to the
 * RecentReportsTable so the user can see what they generated this
 * session — no fake setInterval progress, no fake .pdf size.
 */

const reportTypes: ReportType[] = [
  {
    id: "rebates",
    name: "Rebate Statement",
    description:
      "Per-contract rebate statement: earned this period, collected this period, outstanding balance.",
    icon: DollarSign,
    frequency: "Quarterly",
  },
  {
    id: "performance",
    name: "Performance Summary",
    description:
      "Per-facility roll-up: spend, earned, collected, compliance %, market share %.",
    icon: TrendingUp,
    frequency: "Monthly",
  },
  {
    id: "roster",
    name: "Contract Roster",
    description:
      "All contracts with key terms — start/end, rebate method, status, last activity, lifetime + YTD earned.",
    icon: ClipboardList,
    frequency: "On demand",
  },
  {
    id: "leakage",
    name: "Purchase Leakage",
    description:
      "Off-contract, out-of-period, or significantly off-price purchases of your products.",
    icon: AlertTriangle,
    frequency: "On demand",
  },
]

interface VendorReportsClientProps {
  // vendorId is read by the server actions via the auth gate
  // (`requireVendor`), so we don't pass it through — kept on the prop
  // for future per-vendor UI customization.
  vendorId: string
}

// Default window: trailing 90 days. Each card uses this; future work
// can hoist a per-card date picker.
function defaultPeriod(): { start: Date; end: Date } {
  const end = new Date()
  const start = new Date(end)
  start.setDate(start.getDate() - 90)
  return { start, end }
}

function downloadCSV(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function VendorReportsClient(_props: VendorReportsClientProps) {
  const [selectedFacility, setSelectedFacility] = useState("all")
  const [generatedReports, setGeneratedReports] = useState<RecentReport[]>([])
  const [category, setCategory] = useState<"all" | ReportTypeId>("all")
  const [searchQuery, setSearchQuery] = useState("")

  const generateMutation = useMutation({
    mutationFn: async (report: ReportType) => {
      const { start, end } = defaultPeriod()
      const startISO = start.toISOString().slice(0, 10)
      const endISO = end.toISOString().slice(0, 10)

      let csv: string
      let title: string

      if (report.id === "rebates") {
        const rows = await getVendorRebateStatement(startISO, endISO)
        title = "Vendor Rebate Statement"
        csv = toCSV({
          columns: [
            { key: "contractName", label: "Contract" },
            { key: "facilityName", label: "Facility" },
            {
              key: "earnedThisPeriod",
              label: "Earned This Period",
              format: (v) => formatExportDollars(v as number),
            },
            {
              key: "collectedThisPeriod",
              label: "Collected This Period",
              format: (v) => formatExportDollars(v as number),
            },
            {
              key: "outstanding",
              label: "Outstanding",
              format: (v) => formatExportDollars(v as number),
            },
          ],
          rows,
        })
      } else if (report.id === "performance") {
        const rows = await getVendorPerformanceSummary(startISO, endISO)
        title = "Vendor Performance Summary"
        csv = toCSV({
          columns: [
            { key: "facilityName", label: "Facility" },
            {
              key: "spend",
              label: "Spend",
              format: (v) => formatExportDollars(v as number),
            },
            {
              key: "earned",
              label: "Rebate Earned",
              format: (v) => formatExportDollars(v as number),
            },
            {
              key: "collected",
              label: "Rebate Collected",
              format: (v) => formatExportDollars(v as number),
            },
            {
              key: "compliancePercent",
              label: "Compliance %",
              format: (v) => formatExportPercent(v as number),
            },
            {
              key: "marketSharePercent",
              label: "Market Share %",
              format: (v) => formatExportPercent(v as number),
            },
          ],
          rows,
        })
      } else if (report.id === "roster") {
        const rows = await getVendorContractRoster()
        title = "Vendor Contract Roster"
        csv = toCSV({
          columns: [
            { key: "contractName", label: "Contract" },
            { key: "contractNumber", label: "Contract #" },
            { key: "facilityName", label: "Facility" },
            { key: "status", label: "Status" },
            {
              key: "effectiveDate",
              label: "Effective Date",
              format: (v) => formatExportDate(new Date(v as string | Date)),
            },
            {
              key: "expirationDate",
              label: "Expiration Date",
              format: (v) => formatExportDate(new Date(v as string | Date)),
            },
            { key: "rebateMethod", label: "Rebate Method" },
            {
              key: "lastActivity",
              label: "Last Activity",
              format: (v) =>
                v == null ? "" : formatExportDate(new Date(v as string | Date)),
            },
            {
              key: "rebateEarnedYTD",
              label: "Earned YTD",
              format: (v) => formatExportDollars(v as number),
            },
            {
              key: "rebateEarnedLifetime",
              label: "Earned Lifetime",
              format: (v) => formatExportDollars(v as number),
            },
          ],
          rows,
        })
      } else {
        // Leakage card: scroll the user to the existing card (which has
        // its own date controls and live table). Throw a sentinel so
        // the onSuccess path skips the download.
        const el = document.getElementById("vendor-purchase-leakage")
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" })
        throw new Error("__leakage_scroll__")
      }

      const filename = buildReportFilename(title)
      downloadCSV(csv, filename)
      return {
        report: {
          id: `gen-${Date.now()}`,
          name: `${report.name} — ${startISO} → ${endISO}`,
          type: report.id,
          date: new Date().toISOString().slice(0, 10),
          status: "ready",
          size: formatBytes(new Blob([csv]).size),
        } satisfies RecentReport,
      }
    },
    onSuccess: ({ report }) => {
      setGeneratedReports((prev) => [report, ...prev])
      toast.success(`Generated ${report.name}`, {
        description: "CSV saved to your downloads folder.",
      })
    },
    onError: (err: unknown) => {
      if (err instanceof Error && err.message === "__leakage_scroll__") {
        toast.info("Scrolled to the live Purchase Leakage audit below.")
        return
      }
      const msg = err instanceof Error ? err.message : "Unknown error"
      toast.error("Could not generate report", { description: msg })
    },
  })

  const handleGenerateReport = (report: ReportType) => {
    generateMutation.mutate(report)
  }

  const handleDownload = (report: RecentReport) => {
    // Recent-reports table re-download: not stored server-side, so we
    // hint the user to regenerate from the card above.
    toast.info("Re-generate from the card above to download again.", {
      description: report.name,
    })
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
      facilitiesReached: 0,
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
          product). The Purchase Leakage card on the type grid scrolls
          here. */}
      <div id="vendor-purchase-leakage">
        <VendorPurchaseLeakageCard />
      </div>
    </div>
  )
}
