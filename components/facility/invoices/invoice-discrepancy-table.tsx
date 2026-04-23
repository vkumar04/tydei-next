"use client"

import { Check, Eye, FileText, Flag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency, formatDate } from "@/lib/formatting"

type DisputeStatus = "none" | "disputed" | "resolved" | "rejected"

export type InvoiceRow = {
  id: string
  invoiceNumber: string
  vendor: { name: string }
  invoiceDate: Date | string
  totalInvoiceCost: number | string | null
  totalContractCost: number
  variance: number
  variancePercent: number
  status: string
  flaggedCount: number
  lineItemCount: number
  disputeStatus?: DisputeStatus
  disputeNote?: string | null
}

const statusColors: Record<string, string> = {
  pending:
    "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300",
  disputed:
    "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  resolved:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  verified:
    "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  flagged:
    "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  validated:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
}

export interface InvoiceDiscrepancyTableProps {
  rows: InvoiceRow[]
  loading: boolean
  selectable: boolean
  selectedIds: string[]
  onToggleSelect: (id: string) => void
  onToggleSelectAll: (checked: boolean) => void
  selectableRows: InvoiceRow[]
  onViewDetails: (invoice: InvoiceRow) => void
  onDispute: (invoice: InvoiceRow) => void
  onApprove: (invoiceId: string) => void
  emptyMessage?: string
}

export function InvoiceDiscrepancyTable({
  rows,
  loading,
  selectable,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  selectableRows,
  onViewDetails,
  onDispute,
  onApprove,
  emptyMessage = "No invoices found.",
}: InvoiceDiscrepancyTableProps) {
  const colCount = selectable ? 9 : 8

  return (
    <div className="rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {selectable && (
              <TableHead className="w-12">
                <Checkbox
                  checked={
                    selectableRows.length > 0 &&
                    selectedIds.length === selectableRows.length
                  }
                  onCheckedChange={(checked) => onToggleSelectAll(!!checked)}
                />
              </TableHead>
            )}
            <TableHead>Invoice</TableHead>
            <TableHead>Vendor</TableHead>
            <TableHead>Date</TableHead>
            <TableHead className="text-right">Invoiced</TableHead>
            <TableHead className="text-right">Contract</TableHead>
            <TableHead className="text-right">Variance</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i}>
                {Array.from({ length: colCount }).map((_, j) => (
                  <TableCell key={j}>
                    <Skeleton className="h-4 w-full" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : rows.length > 0 ? (
            rows.map((invoice) => (
              <TableRow key={invoice.id}>
                {selectable && (
                  <TableCell>
                    {invoice.status === "pending" && (
                      <Checkbox
                        checked={selectedIds.includes(invoice.id)}
                        onCheckedChange={() => onToggleSelect(invoice.id)}
                      />
                    )}
                  </TableCell>
                )}
                <TableCell>
                  <div className="flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <span className="font-medium">{invoice.invoiceNumber}</span>
                  </div>
                </TableCell>
                <TableCell>{invoice.vendor.name}</TableCell>
                <TableCell>{formatDate(invoice.invoiceDate)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(Number(invoice.totalInvoiceCost ?? 0))}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(invoice.totalContractCost)}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {invoice.variance > 0.01 ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-medium text-red-600 dark:text-red-400">
                        +{formatCurrency(invoice.variance)}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        +{invoice.variancePercent.toFixed(1)}%
                      </Badge>
                    </div>
                  ) : invoice.variance < -0.01 ? (
                    <div className="flex items-center justify-end gap-2">
                      <span className="font-medium text-green-600 dark:text-green-400">
                        {formatCurrency(invoice.variance)}
                      </span>
                      <Badge variant="outline" className="text-xs">
                        {invoice.variancePercent.toFixed(1)}%
                      </Badge>
                    </div>
                  ) : (
                    <span className="text-green-600 dark:text-green-400">
                      Match
                    </span>
                  )}
                </TableCell>
                <TableCell>
                  <Badge
                    className={
                      statusColors[invoice.status] ??
                      "bg-muted text-muted-foreground"
                    }
                  >
                    {invoice.status}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onViewDetails(invoice)}
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      title={
                        invoice.disputeStatus === "disputed"
                          ? "Resolve dispute"
                          : "Flag as disputed"
                      }
                      onClick={() => onDispute(invoice)}
                    >
                      <Flag
                        className={
                          invoice.disputeStatus === "disputed"
                            ? "h-4 w-4 text-red-600 dark:text-red-400"
                            : "h-4 w-4"
                        }
                      />
                    </Button>
                    {invoice.status === "pending" && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onApprove(invoice.id)}
                      >
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))
          ) : (
            <TableRow>
              <TableCell
                colSpan={colCount}
                className="h-24 text-center text-muted-foreground"
              >
                {emptyMessage}
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  )
}
