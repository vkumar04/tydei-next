"use client"

import { useQuery } from "@tanstack/react-query"
import { Download } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { getStripeInvoices } from "@/lib/actions/admin/billing"
import { queryKeys } from "@/lib/query-keys"
import { toCSV, buildReportFilename } from "@/lib/reports/csv-export"
import {
  formatExportDate,
  formatExportDollars,
} from "@/lib/reports/export-formatters"

/**
 * Header-action export for the Admin Billing page. Re-uses the same
 * `getStripeInvoices` query the BillingClient runs (TanStack Query
 * dedupes by key) so this button doesn't trigger a second roundtrip.
 *
 * Replaces the placeholder `Export Report` button removed in 227defb.
 */
export function BillingExportButton() {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.admin.invoices(),
    queryFn: () => getStripeInvoices({}),
  })

  const invoices = data?.invoices ?? []

  const handleExport = () => {
    if (invoices.length === 0) {
      toast.info("No invoices to export.")
      return
    }
    const exportRows: Record<string, unknown>[] = invoices.map((inv) => ({
      id: inv.id,
      customerName: inv.customerName ?? "",
      customerEmail: inv.customerEmail ?? "",
      date: inv.date,
      period: inv.period ?? "",
      amount: inv.amount,
      status: inv.status,
    }))
    const csv = toCSV({
      columns: [
        { key: "id", label: "Invoice ID" },
        { key: "customerName", label: "Customer" },
        { key: "customerEmail", label: "Customer Email" },
        {
          key: "date",
          label: "Date",
          format: (v) => {
            if (!v) return ""
            const d = new Date(v as string)
            return Number.isNaN(d.getTime()) ? "" : formatExportDate(d)
          },
        },
        { key: "period", label: "Period" },
        {
          key: "amount",
          label: "Amount",
          format: (v) => formatExportDollars(v as number),
        },
        { key: "status", label: "Status" },
      ],
      rows: exportRows,
    })
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = buildReportFilename("Admin Billing Invoices")
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Button
      className="gap-2"
      onClick={handleExport}
      disabled={isLoading || invoices.length === 0}
    >
      <Download className="h-4 w-4" />
      Export Report
    </Button>
  )
}
