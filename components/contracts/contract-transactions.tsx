"use client"

import { useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Calendar,
  Plus,
  ArrowUpRight,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency, formatDate } from "@/lib/formatting"
import { getContractPeriods } from "@/lib/actions/contract-periods"
import { toast } from "sonner"

interface ContractTransactionsProps {
  contractId: string
}

interface PeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  totalSpend: number
  rebateEarned: number
  rebateCollected: number
  tierAchieved: number | null
}

type TransactionType = "rebate" | "credit" | "payment"

function getCollectionStatus(row: PeriodRow): "collected" | "pending" | "overdue" {
  const now = new Date()
  const end = new Date(row.periodEnd)
  if (row.rebateCollected >= row.rebateEarned && row.rebateEarned > 0) return "collected"
  if (end < now && row.rebateCollected < row.rebateEarned) return "overdue"
  return "pending"
}

const collectionStatusConfig: Record<
  string,
  { label: string; className: string }
> = {
  collected: {
    label: "Collected",
    className:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  },
  pending: {
    label: "Pending",
    className:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  },
  overdue: {
    label: "Overdue",
    className:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
  },
}

function getPeriodStatus(periodEnd: string): "completed" | "active" | "upcoming" {
  const now = new Date()
  const end = new Date(periodEnd)
  const start = new Date(periodEnd)
  start.setMonth(start.getMonth() - 3)
  if (end < now) return "completed"
  if (start <= now && end >= now) return "active"
  return "upcoming"
}

const statusConfig: Record<string, { label: string; variant: "default" | "secondary" | "outline" }> = {
  completed: { label: "Completed", variant: "secondary" },
  active: { label: "Active", variant: "default" },
  upcoming: { label: "Upcoming", variant: "outline" },
}

function AddTransactionDialog({ contractId, queryClient }: { contractId: string; queryClient: ReturnType<typeof useQueryClient> }) {
  const [open, setOpen] = useState(false)
  const [type, setType] = useState<TransactionType>("rebate")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState("")

  async function handleSubmit() {
    if (!amount || !description || !date) {
      toast.error("Please fill in all required fields")
      return
    }
    const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ""))
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      toast.error("Please enter a valid amount")
      return
    }
    try {
      const { createContractTransaction } = await import("@/lib/actions/contract-periods")
      await createContractTransaction({
        contractId,
        type: type as "rebate" | "credit" | "payment",
        amount: parsedAmount,
        description,
        date,
      })
      toast.success("Transaction recorded")
      // Refetch periods to show the new transaction
      queryClient.invalidateQueries({ queryKey: ["contractPeriods", contractId] })
    } catch {
      toast.error("Failed to save transaction")
    }
    setType("rebate")
    setAmount("")
    setDescription("")
    setDate("")
    setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" className="gap-2">
          <Plus className="h-4 w-4" />
          Add Transaction
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add Contract Transaction</DialogTitle>
          <DialogDescription>
            Record a rebate, credit, or payment for this contract.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Transaction Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as TransactionType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="rebate">Rebate</SelectItem>
                <SelectItem value="credit">Credit</SelectItem>
                <SelectItem value="payment">Payment</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="txn-amount">Amount *</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="txn-amount"
                placeholder="0.00"
                className="pl-9"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="txn-desc">Description *</Label>
            <Input
              id="txn-desc"
              placeholder="e.g., Q1 2025 Spend Rebate"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="txn-date">Date *</Label>
            <Input
              id="txn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Record Transaction</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function TransactionTable({
  rows,
  filter,
}: {
  rows: PeriodRow[]
  filter: "all" | TransactionType
}) {
  // For now all rows are "rebate" type since we derive from period data
  const filtered = filter === "all" || filter === "rebate" ? rows : []

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <p className="text-sm text-muted-foreground">
          No {filter === "all" ? "" : filter} transactions recorded yet.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Period</TableHead>
            <TableHead>Type</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Rebate Earned</TableHead>
            <TableHead className="text-center">Tier</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="text-center">Collection</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            const status = getPeriodStatus(row.periodEnd)
            const config = statusConfig[status]
            const collection = getCollectionStatus(row)
            const collConfig = collectionStatusConfig[collection]
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  {formatDate(row.periodStart)} &ndash;{" "}
                  {formatDate(row.periodEnd)}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="gap-1">
                    <ArrowUpRight className="h-3 w-3 text-emerald-600" />
                    Rebate
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {formatCurrency(row.totalSpend)}
                </TableCell>
                <TableCell className="text-right text-emerald-600">
                  {formatCurrency(row.rebateEarned)}
                </TableCell>
                <TableCell className="text-center">
                  {row.tierAchieved != null ? (
                    <Badge variant="outline">Tier {row.tierAchieved}</Badge>
                  ) : (
                    <span className="text-muted-foreground">&mdash;</span>
                  )}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant={config.variant}>{config.label}</Badge>
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className={collConfig.className}>
                    {collConfig.label}
                  </Badge>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function ContractTransactions({ contractId }: ContractTransactionsProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"all" | TransactionType>("all")

  const { data: periods, isLoading } = useQuery({
    queryKey: ["contractPeriods", contractId],
    queryFn: () => getContractPeriods(contractId),
    enabled: !!contractId,
  })

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
        <Skeleton className="h-[200px] w-full" />
      </div>
    )
  }

  const rows: PeriodRow[] = (periods ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    periodStart: p.periodStart as string,
    periodEnd: p.periodEnd as string,
    totalSpend: Number(p.totalSpend ?? 0),
    rebateEarned: Number(p.rebateEarned ?? 0),
    rebateCollected: Number(p.rebateCollected ?? 0),
    tierAchieved: p.tierAchieved != null ? Number(p.tierAchieved) : null,
  }))

  const totalRebates = rows.reduce((s, r) => s + r.rebateEarned, 0)
  // Credits and payments are 0 for now since we don't have separate transaction types yet
  const totalCredits = 0
  const totalPayments = 0

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Transaction Ledger
          </CardTitle>
          <AddTransactionDialog contractId={contractId} queryClient={queryClient} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No contract period data available yet. Use &quot;Add Transaction&quot; to record
            rebates, credits, or payments manually.
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Total Rebates</p>
              <p className="text-2xl font-bold text-emerald-600">
                {formatCurrency(totalRebates)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
              <ArrowUpRight className="h-5 w-5 text-emerald-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Total Credits</p>
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(totalCredits)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
              <CreditCard className="h-5 w-5 text-blue-600" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div>
              <p className="text-sm text-muted-foreground">Total Payments</p>
              <p className="text-2xl font-bold text-amber-600">
                {formatCurrency(totalPayments)}
              </p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
              <DollarSign className="h-5 w-5 text-amber-600" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Transactions Table with Tabs */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <TrendingUp className="h-4 w-4" />
              Contract Transactions
            </CardTitle>
            <CardDescription>
              Rebates, credits, and payments for this contract
            </CardDescription>
          </div>
          <AddTransactionDialog contractId={contractId} queryClient={queryClient} />
        </CardHeader>
        <CardContent>
          <Tabs
            value={activeTab}
            onValueChange={(v) => setActiveTab(v as typeof activeTab)}
          >
            <TabsList className="mb-4">
              <TabsTrigger value="all">All ({rows.length})</TabsTrigger>
              <TabsTrigger value="rebate">Rebates ({rows.length})</TabsTrigger>
              <TabsTrigger value="credit">Credits (0)</TabsTrigger>
              <TabsTrigger value="payment">Payments (0)</TabsTrigger>
            </TabsList>

            <TabsContent value={activeTab} className="m-0">
              <TransactionTable rows={rows} filter={activeTab} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
