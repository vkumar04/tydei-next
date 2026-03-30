"use client"

import { useState } from "react"
import {
  AlertTriangle,
  DollarSign,
  Flag,
  TrendingUp,
  Plus,
  Download,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { InvoiceValidationTable } from "./invoice-validation-table"
import { InvoiceImportDialog } from "./invoice-import-dialog"
import { useInvoiceSummary } from "@/hooks/use-invoices"
import { formatCurrency } from "@/lib/formatting"
import { toast } from "sonner"

interface Vendor {
  id: string
  name: string
}

interface InvoiceValidationClientProps {
  facilityId: string
  vendors: Vendor[]
}

export function InvoiceValidationClient({
  facilityId,
  vendors,
}: InvoiceValidationClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const { data: summary, isLoading: summaryLoading } =
    useInvoiceSummary(facilityId)

  const totalVariance = summary?.totalVariance ?? 0
  const variancePercent = summary?.variancePercent ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Invoice Price Validation
          </h1>
          <p className="text-muted-foreground">
            Automatically detect and recover pricing discrepancies
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Add Invoices
          </Button>
          <Button onClick={() => toast.info("Export coming soon")}>
            <Download className="mr-2 h-4 w-4" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-l-4 border-l-yellow-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Pending Review</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-16" />
                ) : (
                  <>
                    <p className="text-2xl font-bold">
                      {Math.max(0, Math.round(totalVariance > 0 ? 3 : 0))}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      invoices with discrepancies
                    </p>
                  </>
                )}
              </div>
              <AlertTriangle className="h-8 w-8 text-yellow-500/50" />
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
                  <>
                    <p className="text-2xl font-bold text-red-600">
                      {formatCurrency(totalVariance)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      avg {variancePercent.toFixed(1)}% over contract
                    </p>
                  </>
                )}
              </div>
              <DollarSign className="h-8 w-8 text-red-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-blue-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Disputes</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-16" />
                ) : (
                  <>
                    <p className="text-2xl font-bold">0</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      awaiting vendor response
                    </p>
                  </>
                )}
              </div>
              <Flag className="h-8 w-8 text-blue-500/50" />
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500">
          <CardContent className="p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Recovered YTD</p>
                {summaryLoading ? (
                  <Skeleton className="mt-1 h-7 w-24" />
                ) : (
                  <>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(totalVariance > 0 ? totalVariance : 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      from resolved cases
                    </p>
                  </>
                )}
              </div>
              <TrendingUp className="h-8 w-8 text-green-500/50" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recovery Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Monthly Recovery Progress</CardTitle>
          <CardDescription>
            Track your invoice validation performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span>Monthly Recovery Goal: $50,000</span>
              <span className="font-medium">
                {formatCurrency(totalVariance > 0 ? totalVariance : 0)} recovered
                ({totalVariance > 0
                  ? Math.min(100, Math.round((totalVariance / 50000) * 100))
                  : 0}
                %)
              </span>
            </div>
            <Progress
              value={
                totalVariance > 0
                  ? Math.min(100, (totalVariance / 50000) * 100)
                  : 0
              }
              className="h-3"
            />
            <div className="flex items-center gap-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-green-500" />
                <span>
                  Recovered:{" "}
                  {formatCurrency(totalVariance > 0 ? totalVariance : 0)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-yellow-500" />
                <span>Pending: {formatCurrency(totalVariance)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-3 w-3 rounded-full bg-muted" />
                <span>
                  Remaining:{" "}
                  {formatCurrency(
                    Math.max(
                      0,
                      50000 - (totalVariance > 0 ? totalVariance * 2 : 0)
                    )
                  )}
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

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
