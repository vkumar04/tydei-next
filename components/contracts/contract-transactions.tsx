"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DollarSign,
  TrendingUp,
  CreditCard,
  Calendar,
  HelpCircle,
  ArrowUpRight,
  RefreshCw,
} from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
import {
  displayedCollected,
  type PeriodRow,
} from "@/lib/contracts/transactions-display"
import { getContractPeriods, getContractRebates } from "@/lib/actions/contract-periods"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "sonner"

interface ContractTransactionsProps {
  contractId: string
}

type TransactionType = "rebate" | "credit" | "payment"
type RebateKind = "earned" | "collected"

function getCollectionStatus(row: PeriodRow): "collected" | "pending" | "overdue" {
  // Charles W1.N (CLAUDE.md invariant): a rebate is "collected" only when
  // a Rebate row with a non-null `collectionDate` exists. ContractPeriod
  // rollups are projections — their `rebateCollected` is seed-synthesized
  // and does NOT represent actual money received, so they cannot drive the
  // "Collected" badge here.
  if (row.source === "rebate" && row.collectionDate) return "collected"
  const now = new Date()
  const end = new Date(row.periodEnd)
  if (end < now && row.rebateEarned > 0) return "overdue"
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

// Charles R5.34-b: the previous single "Add Transaction" dialog had a
// kind selector (earned vs collected) tucked inside a second <Select>
// which defaulted to "earned". That was easy to miss — Charles logged
// a collection and the amount landed in rebateEarned. Fix: split the
// one button into three explicit buttons. Each opens a dialog that
// hardcodes `mode`, so the user can't pick the wrong one.
//
// Charles W1.K: the "Log Earned Rebate" manual-entry button was
// semantically wrong — earned rebates are an ACCRUAL the engine
// computes from spend × tier rate × closed period, never a
// human-entered number. That button is gone; its slot is now the
// "Recompute Earned Rebates" action which invokes
// `recomputeAccrualForContract`. Dialog machinery still supports the
// "rebate-earned" kind because `createContractTransaction` still
// accepts it and other call sites (imports, scripts) may drive it.
//
//   - "Log Collected Rebate" → type=rebate, rebateKind=collected
//   - "Log Credit / Payment" → type=credit | payment (sub-selected)
//
// The server action (createContractTransaction) is unchanged.
type DialogMode =
  | { kind: "rebate-collected" }
  | { kind: "credit-or-payment" }

function dialogTitle(mode: DialogMode): string {
  if (mode.kind === "rebate-collected") return "Log Collected Rebate"
  return "Log Credit or Payment"
}

function dialogDescription(mode: DialogMode): string {
  if (mode.kind === "rebate-collected")
    return "Records a payment received from the vendor. Adds to Rebates Collected only — does NOT add to Rebates Earned."
  return "Records a credit memo or vendor payment against this contract."
}

function TransactionDialog({
  contractId,
  queryClient,
  mode,
  open,
  onOpenChange,
}: {
  contractId: string
  queryClient: ReturnType<typeof useQueryClient>
  mode: DialogMode
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  // For the credit/payment dialog only, let the user pick which of the two.
  const [cpType, setCpType] = useState<"credit" | "payment">("credit")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState("")
  const [quantity, setQuantity] = useState("")

  function reset() {
    setCpType("credit")
    setAmount("")
    setDescription("")
    setDate("")
    setQuantity("")
  }

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
    // Quantity is optional on rebate-collected entries (R5.16 kept it on
    // the collected-rebate dialog for per-unit / per-procedure contracts
    // where the vendor settles with a quantity as well as a dollar
    // amount). Ignored for credit/payment.
    let parsedQuantity: number | undefined
    if (mode.kind === "rebate-collected" && quantity.trim() !== "") {
      const q = parseFloat(quantity.replace(/[^0-9.]/g, ""))
      if (isNaN(q) || q <= 0) {
        toast.error("Please enter a valid quantity")
        return
      }
      parsedQuantity = q
    }

    // Dispatch mode → (type, rebateKind) with NO defaulting — the button
    // the user clicked fully determines the split.
    let type: TransactionType
    let rebateKind: RebateKind | undefined
    if (mode.kind === "rebate-collected") {
      type = "rebate"
      rebateKind = "collected"
    } else {
      type = cpType
      rebateKind = undefined
    }

    try {
      const { createContractTransaction } = await import("@/lib/actions/contract-periods")
      await createContractTransaction({
        contractId,
        type,
        amount: parsedAmount,
        description,
        date,
        rebateKind,
        quantity: parsedQuantity,
      })
      toast.success("Transaction recorded")
      // Refetch periods + rebates to surface the new row, and invalidate
      // the contract detail so the "Rebates Earned / Collected" cards
      // pick it up immediately (rebates are a fact written into the
      // `Rebate` table and aggregated server-side — see getContract).
      queryClient.invalidateQueries({ queryKey: ["contract-periods", contractId] })
      queryClient.invalidateQueries({ queryKey: ["contractPeriods", contractId] })
      queryClient.invalidateQueries({ queryKey: ["contractRebates", contractId] })
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      })
    } catch {
      toast.error("Failed to save transaction")
    }
    reset()
    onOpenChange(false)
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset()
        onOpenChange(next)
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{dialogTitle(mode)}</DialogTitle>
          <DialogDescription>{dialogDescription(mode)}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {mode.kind === "credit-or-payment" && (
            <div className="space-y-2">
              <Label>Transaction Type</Label>
              <Select
                value={cpType}
                onValueChange={(v) => setCpType(v as "credit" | "payment")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="credit">Credit</SelectItem>
                  <SelectItem value="payment">Payment</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
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
          {mode.kind === "rebate-collected" && (
            <div className="space-y-2">
              <Label htmlFor="txn-qty">Quantity</Label>
              <Input
                id="txn-qty"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="e.g., 120"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Optional. Units or procedures this collection covers (for
                per-unit or per-procedure contract terms).
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="txn-desc">Description *</Label>
            <Input
              id="txn-desc"
              placeholder={
                mode.kind === "rebate-collected"
                  ? "e.g., Q1 2025 rebate check received"
                  : "e.g., Q1 2025 credit memo"
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="txn-date">
              {mode.kind === "rebate-collected" ? "Collection Date *" : "Date *"}
            </Label>
            <Input
              id="txn-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Record Transaction</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AddTransactionButtons({
  contractId,
  queryClient,
}: {
  contractId: string
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const [mode, setMode] = useState<DialogMode | null>(null)

  // Charles W1.K: recompute auto-accrual Rebate rows on demand. The
  // engine is the single source of truth for earned numbers — this
  // button just invokes it from the UI and reports the result. We
  // capture the pre-recompute `sumEarned` via a staged mutationFn so
  // the toast can describe how far the number moved.
  const recompute = useMutation({
    mutationFn: async () => {
      const result = await recomputeAccrualForContract(contractId)
      return result
    },
    onSuccess: (result) => {
      const earned = result.sumEarned
      toast.success(
        `Regenerated ${result.inserted} auto-accrual ${result.inserted === 1 ? "row" : "rows"} across closed periods — $${earned.toLocaleString(undefined, { maximumFractionDigits: 2 })} earned.`,
      )
      queryClient.invalidateQueries({
        queryKey: ["contract-periods", contractId],
      })
      queryClient.invalidateQueries({
        queryKey: ["contractPeriods", contractId],
      })
      queryClient.invalidateQueries({
        queryKey: ["contractRebates", contractId],
      })
      queryClient.invalidateQueries({
        queryKey: queryKeys.contracts.detail(contractId),
      })
    },
    onError: () => {
      toast.error("Failed to recompute earned rebates")
    },
  })

  return (
    <>
      <div className="flex flex-col items-start gap-2">
        <p className="text-xs text-muted-foreground">
          Earned rebates are computed automatically from spend &times; tier
          rate each time a rebate period closes. Click Recompute to refresh
          from current tier settings.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            className="gap-2"
            onClick={() => recompute.mutate()}
            disabled={recompute.isPending}
          >
            <RefreshCw
              className={`h-4 w-4 ${recompute.isPending ? "animate-spin" : ""}`}
            />
            {recompute.isPending ? "Recomputing…" : "Recompute Earned Rebates"}
          </Button>
          <Button
            size="sm"
            variant="secondary"
            className="gap-2"
            onClick={() => setMode({ kind: "rebate-collected" })}
          >
            <CreditCard className="h-4 w-4" />
            Log Collected Rebate
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="gap-2"
            onClick={() => setMode({ kind: "credit-or-payment" })}
          >
            <DollarSign className="h-4 w-4" />
            Log Credit / Payment
          </Button>
        </div>
      </div>
      {mode !== null && (
        <TransactionDialog
          contractId={contractId}
          queryClient={queryClient}
          mode={mode}
          open={mode !== null}
          onOpenChange={(next) => {
            if (!next) setMode(null)
          }}
        />
      )}
    </>
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
            <TableHead className="text-right">Rebate Collected</TableHead>
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
                <TableCell className="text-right text-blue-600">
                  {formatCurrency(displayedCollected(row))}
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
  const { data: rebatesData, isLoading: rebatesLoading } = useQuery({
    queryKey: ["contractRebates", contractId],
    queryFn: () => getContractRebates(contractId),
    enabled: !!contractId,
  })

  if (isLoading || rebatesLoading) {
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

  const periodRows: PeriodRow[] = (periods ?? []).map((p: Record<string, unknown>) => ({
    id: p.id as string,
    periodStart: p.periodStart as string,
    periodEnd: p.periodEnd as string,
    totalSpend: Number(p.totalSpend ?? 0),
    rebateEarned: Number(p.rebateEarned ?? 0),
    rebateCollected: Number(p.rebateCollected ?? 0),
    tierAchieved: p.tierAchieved != null ? Number(p.tierAchieved) : null,
    source: "period" as const,
    collectionDate: null,
    notes: null,
  }))

  // Surface explicit Rebate rows the user logged via "Add Transaction"
  // (or any imported rebate). These feed the detail page's "Rebates Earned"
  // card directly, so showing them here gives a consistent audit trail.
  const rebateRows: PeriodRow[] = ((rebatesData ?? []) as Array<Record<string, unknown>>).map((r) => ({
    id: r.id as string,
    periodStart: r.payPeriodStart as string,
    periodEnd: r.payPeriodEnd as string,
    totalSpend: 0,
    rebateEarned: Number(r.rebateEarned ?? 0),
    rebateCollected: Number(r.rebateCollected ?? 0),
    tierAchieved: null,
    source: "rebate" as const,
    collectionDate: (r.collectionDate as string | null) ?? null,
    notes: (r.notes as string | null) ?? null,
  }))

  const rows: PeriodRow[] = [...rebateRows, ...periodRows].sort(
    (a, b) => new Date(b.periodEnd).getTime() - new Date(a.periodEnd).getTime(),
  )

  // Lifetime earned rebates across every CLOSED period on this contract
  // (Charles R5.27). "Closed" means periodEnd <= today — applied to both
  // Rebate rows and ContractPeriod rollups so the number matches the
  // scope advertised in the tooltip below, and stays distinct from the
  // header's "Rebates Earned (YTD)" card.
  const today = new Date()
  const totalRebates = rows.reduce((s, r) => {
    if (!r.periodEnd) return s
    return new Date(r.periodEnd) <= today ? s + r.rebateEarned : s
  }, 0)
  // Charles W1.N: "Total Collected" sums ONLY Rebate rows with a non-null
  // `collectionDate` — the CLAUDE.md invariant. ContractPeriod rollups
  // carry a seed-synthesized `rebateCollected` (a projection), but there
  // is no ContractPeriod.collectionDate column to mark actual receipt, so
  // those rows never contribute here regardless of their stored value.
  // This matches the contract detail's "Rebates Collected" card and
  // R5.27's lifetime aggregate, so Charles sees one consistent number
  // across every surface.
  const totalCollected = rows.reduce(
    (s, r) => s + displayedCollected(r),
    0,
  )
  const totalPayments = 0

  if (rows.length === 0) {
    return (
      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Transaction Ledger
          </CardTitle>
          <AddTransactionButtons contractId={contractId} queryClient={queryClient} />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No contract period data available yet. Click &quot;Recompute Earned
            Rebates&quot; to generate accruals from current tier settings, or use
            the Log buttons to record collected rebates, credits, or payments.
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
              <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                Total Rebates (Lifetime)
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help items-center">
                        <HelpCircle
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Total Rebates (Lifetime) help"
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[320px] p-3 text-xs">
                      <p>
                        Lifetime earned rebates across every closed period on
                        this contract. Compare with the &quot;Rebates Earned
                        (YTD)&quot; stat in the header, which is limited to
                        closed periods in the current calendar year.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </p>
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
              <p className="text-sm text-muted-foreground">Collected</p>
              <p className="text-2xl font-bold text-blue-600">
                {formatCurrency(totalCollected)}
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
          <AddTransactionButtons contractId={contractId} queryClient={queryClient} />
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
              {/* credit/payment counts stay at 0 until separate transaction
                  types are first-class; rebate rows cover both Rebate +
                  ContractPeriod ledger entries. */}
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
