"use client"

import { useQuery } from "@tanstack/react-query"
import { PriceDiscrepancyTable } from "@/components/facility/reports/price-discrepancy-table"
import { PriceVarianceDashboard } from "@/components/facility/reports/price-variance-dashboard"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { ChevronLeft, Download } from "lucide-react"
import Link from "next/link"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { queryKeys } from "@/lib/query-keys"
import { getPriceDiscrepancies } from "@/lib/actions/reports"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import {
  formatExportDollars,
  formatExportPercent,
} from "@/lib/reports/export-formatters"
import { toast } from "sonner"

export default function PriceDiscrepancyPage() {
  // facilityId is validated upstream by the facility dashboard layout
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.priceDiscrepancies("current"),
    queryFn: () => getPriceDiscrepancies("current"),
  })

  const handleExport = () => {
    const rows = data ?? []
    if (rows.length === 0) {
      toast.info("No price discrepancies to export.")
      return
    }
    const csv = toCSV({
      columns: [
        { key: "invoiceNumber", label: "Invoice #" },
        { key: "vendorName", label: "Vendor" },
        { key: "itemDescription", label: "Item" },
        { key: "vendorItemNo", label: "Vendor Item #" },
        {
          key: "invoicePrice",
          label: "Invoice Price",
          format: (v) => formatExportDollars(v as number),
        },
        {
          key: "contractPrice",
          label: "Contract Price",
          format: (v) =>
            v == null ? "" : formatExportDollars(v as number),
        },
        {
          key: "variancePercent",
          label: "Variance %",
          format: (v) =>
            v == null ? "" : formatExportPercent(v as number),
        },
        {
          key: "quantity",
          label: "Quantity",
          format: (v) => String(v ?? ""),
        },
        {
          key: "totalLineCost",
          label: "Total Line Cost",
          format: (v) => formatExportDollars(v as number),
        },
        {
          key: "isFlagged",
          label: "Flagged",
          format: (v) => (v ? "true" : "false"),
        },
      ],
      rows,
    })
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = buildReportFilename("Price Discrepancy")
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/dashboard/reports">
            <Button variant="ghost" size="icon">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-balance">
              Price Discrepancy Report
            </h1>
            <p className="text-muted-foreground">
              Identify and resolve pricing variances between contracts, pricing
              files, and actual purchases
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={handleExport}
            disabled={isLoading || (data?.length ?? 0) === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      <Tabs defaultValue="severity" className="space-y-6">
        <TabsList>
          <TabsTrigger value="severity">By severity</TabsTrigger>
          <TabsTrigger value="detail">Line-item detail</TabsTrigger>
        </TabsList>
        <TabsContent value="severity" className="space-y-6">
          <PriceVarianceDashboard facilityId="current" />
        </TabsContent>
        <TabsContent value="detail" className="space-y-6">
          {isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : (
            <PriceDiscrepancyTable discrepancies={data ?? []} />
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
