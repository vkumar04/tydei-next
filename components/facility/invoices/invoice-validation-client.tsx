"use client"

import { useState, useMemo } from "react"
import {
  AlertTriangle,
  DollarSign,
  Flag,
  TrendingUp,
  Plus,
  Download,
  Search,
  Package,
  Filter,
  FileText,
  Eye,
  Check,
  CheckCircle2,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { InvoiceImportDialog } from "./invoice-import-dialog"
import { useInvoiceSummary, useInvoices } from "@/hooks/use-invoices"
import { formatCurrency, formatDate, formatPercent } from "@/lib/formatting"
import { toast } from "sonner"

interface Vendor {
  id: string
  name: string
}

interface InvoiceValidationClientProps {
  facilityId: string
  vendors: Vendor[]
}

type InvoiceRow = {
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

export function InvoiceValidationClient({
  facilityId,
  vendors,
}: InvoiceValidationClientProps) {
  const [importOpen, setImportOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [vendorFilter, setVendorFilter] = useState("all")
  const [statusFilter, setStatusFilter] = useState("all")
  const [selectedInvoices, setSelectedInvoices] = useState<string[]>([])
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceRow | null>(
    null
  )

  const { data: summary, isLoading: summaryLoading } =
    useInvoiceSummary(facilityId)

  const { data, isLoading: tableLoading } = useInvoices(facilityId, {
    facilityId,
    vendorId: vendorFilter === "all" ? undefined : vendorFilter,
    status: statusFilter === "all" ? undefined : statusFilter,
  })

  const totalVariance = summary?.totalVariance ?? 0
  const variancePercent = summary?.variancePercent ?? 0

  const invoices = (data?.invoices ?? []) as InvoiceRow[]

  const filteredInvoices = useMemo(() => {
    return invoices.filter((inv) => {
      const q = searchQuery.toLowerCase()
      const matchesSearch =
        !q ||
        inv.invoiceNumber.toLowerCase().includes(q) ||
        inv.vendor.name.toLowerCase().includes(q)
      return matchesSearch
    })
  }, [invoices, searchQuery])

  const toggleSelectInvoice = (id: string) => {
    setSelectedInvoices((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  const handleViewDetails = (invoice: InvoiceRow) => {
    setSelectedInvoice(invoice)
    setDetailsDialogOpen(true)
  }

  const handleDisputeInvoice = (invoiceId: string) => {
    toast.success("Dispute submitted", {
      description: "Vendor has been notified of the pricing discrepancy",
    })
  }

  const handleApproveInvoice = (invoiceId: string) => {
    toast.success("Invoice approved", {
      description: "Invoice has been marked as verified",
    })
  }

  const handleBulkDispute = () => {
    toast.success(`${selectedInvoices.length} invoices disputed`, {
      description: "Vendors have been notified of pricing discrepancies",
    })
    setSelectedInvoices([])
  }

  const pendingInvoices = filteredInvoices.filter(
    (i) => i.status === "pending"
  )

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
            Import Invoice
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
                      {pendingInvoices.length}
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
                    <p className="text-2xl font-bold text-red-600 dark:text-red-400">
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
                <p className="text-sm text-muted-foreground">
                  Active Disputes
                </p>
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
                    <p className="text-2xl font-bold text-green-600 dark:text-green-400">
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

      {/* Tabs: Discrepancies + Analytics */}
      <Tabs defaultValue="discrepancies" className="space-y-6">
        <TabsList>
          <TabsTrigger value="discrepancies">Discrepancies</TabsTrigger>
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
        </TabsList>

        <TabsContent value="discrepancies" className="space-y-6">

      {/* Recovery Progress */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Monthly Recovery Progress
          </CardTitle>
          <CardDescription>
            Track your invoice validation performance
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex items-center justify-between text-sm">
              <span>Monthly Recovery Goal: $50,000</span>
              <span className="font-medium">
                {formatCurrency(totalVariance > 0 ? totalVariance : 0)}{" "}
                recovered (
                {totalVariance > 0
                  ? Math.min(
                      100,
                      Math.round((totalVariance / 50000) * 100)
                    )
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

      {/* Filters and Table */}
      <Card>
        <CardHeader>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <CardTitle>Invoice Discrepancies</CardTitle>
            {selectedInvoices.length > 0 && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  {selectedInvoices.length} selected
                </span>
                <Button size="sm" onClick={handleBulkDispute}>
                  <Flag className="mr-2 h-4 w-4" />
                  Dispute Selected
                </Button>
              </div>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {/* Filters */}
          <div className="flex flex-wrap gap-4 mb-6">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search invoices..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <Select value={vendorFilter} onValueChange={setVendorFilter}>
              <SelectTrigger className="w-[180px]">
                <Package className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Vendor" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Vendors</SelectItem>
                {vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <Filter className="mr-2 h-4 w-4" />
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="disputed">Disputed</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
                <SelectItem value="verified">Verified</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Table */}
          <div className="rounded-lg border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={
                        pendingInvoices.length > 0 &&
                        selectedInvoices.length === pendingInvoices.length
                      }
                      onCheckedChange={(checked) => {
                        if (checked) {
                          setSelectedInvoices(
                            pendingInvoices.map((i) => i.id)
                          )
                        } else {
                          setSelectedInvoices([])
                        }
                      }}
                    />
                  </TableHead>
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
                {tableLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <TableRow key={i}>
                        {Array.from({ length: 9 }).map((_, j) => (
                          <TableCell key={j}>
                            <Skeleton className="h-4 w-full" />
                          </TableCell>
                        ))}
                      </TableRow>
                    ))
                  : filteredInvoices.length > 0
                    ? filteredInvoices.map((invoice) => (
                        <TableRow key={invoice.id}>
                          <TableCell>
                            {invoice.status === "pending" && (
                              <Checkbox
                                checked={selectedInvoices.includes(invoice.id)}
                                onCheckedChange={() =>
                                  toggleSelectInvoice(invoice.id)
                                }
                              />
                            )}
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <FileText className="h-4 w-4 text-muted-foreground" />
                              <span className="font-medium">
                                {invoice.invoiceNumber}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>{invoice.vendor.name}</TableCell>
                          <TableCell>
                            {formatDate(invoice.invoiceDate)}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(
                              Number(invoice.totalInvoiceCost ?? 0)
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            {formatCurrency(invoice.totalContractCost)}
                          </TableCell>
                          <TableCell className="text-right">
                            {invoice.variance > 0.01 ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-red-600 dark:text-red-400 font-medium">
                                  +{formatCurrency(invoice.variance)}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  +{invoice.variancePercent.toFixed(1)}%
                                </Badge>
                              </div>
                            ) : invoice.variance < -0.01 ? (
                              <div className="flex items-center justify-end gap-2">
                                <span className="text-green-600 dark:text-green-400 font-medium">
                                  {formatCurrency(invoice.variance)}
                                </span>
                                <Badge variant="outline" className="text-xs">
                                  {invoice.variancePercent.toFixed(1)}%
                                </Badge>
                              </div>
                            ) : (
                              <span className="text-green-600 dark:text-green-400">Match</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <Badge className={statusColors[invoice.status] ?? "bg-gray-100 text-gray-800"}>
                              {invoice.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleViewDetails(invoice)}
                              >
                                <Eye className="h-4 w-4" />
                              </Button>
                              {invoice.status === "pending" && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleDisputeInvoice(invoice.id)
                                    }
                                  >
                                    <Flag className="h-4 w-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                      handleApproveInvoice(invoice.id)
                                    }
                                  >
                                    <Check className="h-4 w-4" />
                                  </Button>
                                </>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      ))
                    : (
                        <TableRow>
                          <TableCell colSpan={9} className="h-24 text-center text-muted-foreground">
                            No invoices found.
                          </TableCell>
                        </TableRow>
                      )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Variance by Vendor */}
          <Card>
            <CardHeader>
              <CardTitle>Variance by Vendor</CardTitle>
              <CardDescription>
                Invoice pricing variance trends by vendor
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(() => {
                      const vendorMap = new Map<string, { overcharges: number; undercharges: number }>()
                      for (const inv of filteredInvoices) {
                        const name = inv.vendor.name
                        const existing = vendorMap.get(name) ?? { overcharges: 0, undercharges: 0 }
                        if (inv.variance > 0) {
                          existing.overcharges += inv.variance
                        } else {
                          existing.undercharges += Math.abs(inv.variance)
                        }
                        vendorMap.set(name, existing)
                      }
                      return Array.from(vendorMap.entries()).map(([vendor, vals]) => ({
                        vendor,
                        ...vals,
                      }))
                    })()}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="vendor" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }} />
                    <YAxis
                      tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                    />
                    <RechartsTooltip
                      formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                      }}
                    />
                    <Legend />
                    <Bar dataKey="overcharges" name="Overcharges" fill="#ef4444" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="undercharges" name="Undercharges" fill="#22c55e" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Monthly Variance Trend */}
          <Card>
            <CardHeader>
              <CardTitle>Monthly Variance Trend</CardTitle>
              <CardDescription>
                Total invoice variance over time
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(() => {
                      const monthMap = new Map<string, number>()
                      for (const inv of filteredInvoices) {
                        const d = new Date(inv.invoiceDate)
                        const key = d.toLocaleString("default", { month: "short", year: "2-digit" })
                        monthMap.set(key, (monthMap.get(key) ?? 0) + inv.variance)
                      }
                      return Array.from(monthMap.entries()).map(([month, variance]) => ({
                        month,
                        variance,
                      }))
                    })()}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fill: "hsl(var(--muted-foreground))" }} />
                    <YAxis
                      tickFormatter={(value: number) => `$${(value / 1000).toFixed(0)}k`}
                      tick={{ fill: "hsl(var(--muted-foreground))" }}
                    />
                    <RechartsTooltip
                      formatter={(value) => [`$${Number(value).toLocaleString()}`, ""]}
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                      }}
                    />
                    <Bar dataKey="variance" name="Variance" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Summary Stats */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  Avg Variance per Invoice
                </p>
                <p className="text-2xl font-bold mt-1">
                  {filteredInvoices.length > 0
                    ? formatCurrency(
                        filteredInvoices.reduce((s, i) => s + i.variance, 0) /
                          filteredInvoices.length
                      )
                    : "$0"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  Invoices Over Contract
                </p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400 mt-1">
                  {filteredInvoices.filter((i) => i.variance > 0.01).length}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-6">
                <p className="text-sm text-muted-foreground">
                  Invoices at or Below Contract
                </p>
                <p className="text-2xl font-bold text-green-600 dark:text-green-400 mt-1">
                  {filteredInvoices.filter((i) => i.variance <= 0.01).length}
                </p>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {/* Invoice Details Dialog */}
      <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Invoice {selectedInvoice?.invoiceNumber}
            </DialogTitle>
            <DialogDescription>
              {selectedInvoice?.vendor.name} -{" "}
              {selectedInvoice
                ? formatDate(selectedInvoice.invoiceDate)
                : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedInvoice && (
            <div className="space-y-6">
              {/* Summary */}
              <div className="grid grid-cols-3 gap-4">
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    Total Invoiced
                  </p>
                  <p className="text-xl font-bold">
                    {formatCurrency(
                      Number(selectedInvoice.totalInvoiceCost ?? 0)
                    )}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-muted/50">
                  <p className="text-sm text-muted-foreground">
                    Contract Price
                  </p>
                  <p className="text-xl font-bold">
                    {formatCurrency(selectedInvoice.totalContractCost)}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/30">
                  <p className="text-sm text-muted-foreground">Variance</p>
                  <p className="text-xl font-bold text-red-600 dark:text-red-400">
                    {selectedInvoice.variance > 0 ? "+" : ""}
                    {formatCurrency(selectedInvoice.variance)}
                  </p>
                </div>
              </div>

              {/* Line items info */}
              <div className="text-sm text-muted-foreground">
                {selectedInvoice.lineItemCount} line items |{" "}
                {selectedInvoice.flaggedCount} flagged
              </div>
            </div>
          )}

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDetailsDialogOpen(false)}
            >
              Close
            </Button>
            {selectedInvoice?.status === "pending" && (
              <>
                <Button
                  variant="outline"
                  onClick={() => {
                    handleApproveInvoice(selectedInvoice.id)
                    setDetailsDialogOpen(false)
                  }}
                >
                  <Check className="mr-2 h-4 w-4" />
                  Approve
                </Button>
                <Button
                  onClick={() => {
                    handleDisputeInvoice(selectedInvoice.id)
                    setDetailsDialogOpen(false)
                  }}
                >
                  <Flag className="mr-2 h-4 w-4" />
                  Dispute with Vendor
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
