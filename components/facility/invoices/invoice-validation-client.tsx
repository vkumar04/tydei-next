"use client"

import { useState } from "react"
import { Upload, DollarSign, FileText, TrendingDown, Percent } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
import { InvoiceValidationTable } from "./invoice-validation-table"
import { InvoiceImportDialog } from "./invoice-import-dialog"
import { Button } from "@/components/ui/button"
import { useInvoiceSummary } from "@/hooks/use-invoices"
import { formatCurrency, formatPercent } from "@/lib/formatting"

interface Vendor {
  id: string
  name: string
}

interface InvoiceValidationClientProps {
  facilityId: string
  vendors: Vendor[]
}

export function InvoiceValidationClient({ facilityId, vendors }: InvoiceValidationClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const { data: summary, isLoading: summaryLoading } = useInvoiceSummary(facilityId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoice Validation"
        description="Validate invoices against contract pricing"
        action={
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-4" /> Import Invoice
          </Button>
        }
      />

      {/* Variance Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Invoiced</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-24" />
                ) : (
                  <p className="text-2xl font-bold">
                    {formatCurrency(summary?.totalInvoiced ?? 0)}
                  </p>
                )}
              </div>
              <FileText className="size-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Contracted</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-24" />
                ) : (
                  <p className="text-2xl font-bold">
                    {formatCurrency(summary?.totalContracted ?? 0)}
                  </p>
                )}
              </div>
              <DollarSign className="size-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Variance</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-24" />
                ) : (
                  <p className="text-2xl font-bold text-red-600">
                    {formatCurrency(summary?.totalVariance ?? 0)}
                  </p>
                )}
              </div>
              <TrendingDown className="size-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Variance %</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-16" />
                ) : (
                  <p className="text-2xl font-bold">
                    {formatPercent(summary?.variancePercent ?? 0)}
                  </p>
                )}
              </div>
              <Percent className="size-8 text-yellow-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      <InvoiceValidationTable facilityId={facilityId} vendors={vendors} />
      <InvoiceImportDialog
        facilityId={facilityId}
        vendors={vendors}
        open={importOpen}
        onOpenChange={setImportOpen}
        onComplete={() => {}}
      />
    </div>
  )
}
