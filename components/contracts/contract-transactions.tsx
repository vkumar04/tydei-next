"use client"

import type { ContractType } from "@prisma/client"
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
  MoreHorizontal,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { formatCurrency, formatDate, formatCalendarDate } from "@/lib/formatting"
import {
  getContractRebates,
  updateContractTransaction,
  deleteContractTransaction,
} from "@/lib/actions/contract-periods"
import { sumCollectedRebates } from "@/lib/contracts/rebate-collected-filter"
import { sumEarnedRebatesLifetime } from "@/lib/contracts/rebate-earned-filter"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { mapRebateRowsToLedger } from "@/components/contracts/contract-transactions-display"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "sonner"
import {
  TransactionDialog,
  type DialogMode,
} from "@/components/contracts/transactions/_transaction-dialog"
import { EditTransactionDialog } from "@/components/contracts/transactions/_edit-transaction-dialog"

interface ContractTransactionsProps {
  contractId: string
  contractType: ContractType
}

// Charles W1.P: the ledger now has a single source (the `Rebate` table).
// ContractPeriod rollups have been dropped — seed-populated rebateEarned
// values don't respect current tier config and produced ghost rows
// (e.g. $0 spend with $76K earned). The Recompute Earned Rebates button
// is the user's path to regenerate accrual Rebate rows from tier terms.
interface PeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  totalSpend: number
  rebateEarned: number
  rebateCollected: number
  tierAchieved: number | null
  collectionDate?: string | null
  notes?: string | null
  createdAt?: string | null
}

type TransactionType = "rebate" | "credit" | "payment"

function getCollectionStatus(row: PeriodRow): "collected" | "pending" | "overdue" {
  // 2026-04-26 (F2-M1): the canonical "Rebates Collected" rule (CLAUDE.md
  // invariants: sumCollectedRebates) gates ONLY on collectionDate. The
  // previous fallback "rebateCollected >= rebateEarned" returned "collected"
  // even on rows with collectionDate=null, contradicting the header card
  // and the Transactions summary card. We keep collectionDate as the sole
  // source of truth.
  if (row.collectionDate) return "collected"
  const now = new Date()
  const end = new Date(row.periodEnd)
  if (end < now && row.rebateEarned > 0) return "overdue"
  return "pending"
}

/**
 * Per-row "Collected" amount — gates on collectionDate per the canonical
 * sumCollectedRebates rule. Without this, rows with rebateCollected populated
 * but collectionDate=null silently inflated the per-row column while the
 * summary card (which DOES gate) read $0. Same drift the F2-M1 audit caught.
 */
function rebateCollectedForRow(row: PeriodRow): number {
  return row.collectionDate ? row.rebateCollected : 0
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

// Charles W1.W-C1: `getPeriodStatus` + `statusConfig` removed — the
// ledger's "Status" column now shows the collection status (Collected /
// Pending / Overdue) only. "Completed / Active / Upcoming" referred to
// the period window relative to today, which duplicated information
// already carried by the period dates.

function AddTransactionButtons({
  contractId,
  contractType,
  queryClient,
  earnedRows,
}: {
  contractId: string
  contractType: ContractType
  queryClient: ReturnType<typeof useQueryClient>
  // Charles W1.W-C1: used by the Log-Collected-Rebate dialog's period
  // dropdown so the user can pick the earned row to stamp collected.
  earnedRows: PeriodRow[]
}) {
  // Charles 2026-04-24: credits/payments apply only to contract types that
  // carry a payable balance to the vendor — capital (amortizing), service
  // (recurring invoice), tie-in (capital + usage). Usage, grouped, and
  // pricing_only contracts have no invoice stream to credit/pay against.
  const supportsCreditPayment =
    contractType === "capital" ||
    contractType === "service" ||
    contractType === "tie_in"
  const [mode, setMode] = useState<DialogMode | null>(null)

  // Charles W1.K: recompute auto-accrual Rebate rows on demand. The
  // engine is the single source of truth for earned numbers — this
  // button just invokes it from the UI and reports the result. We
  // capture the pre-recompute `sumEarned` via a staged mutationFn so
  // the toast can describe how far the number moved.
  const recompute = useMutation({
    mutationFn: async () => {
      const result = await recomputeAccrualForContract(contractId)
      // 2026-04-28 strategic-direction Plan #1: refresh persisted
      // derived metrics (complianceRate, currentMarketShare,
      // annualValue) on the same click so the contract-detail header
      // never falls behind the recompute. Best-effort — a metrics
      // failure shouldn't surface a recompute success as an error.
      try {
        const { refreshContractMetrics } = await import(
          "@/lib/actions/contracts/refresh-metrics"
        )
        await refreshContractMetrics(contractId)
      } catch (err) {
        console.warn("[recompute] refreshContractMetrics failed", err)
      }
      return result
    },
    onSuccess: (result) => {
      const earned = result.sumEarned
      toast.success(
        `Regenerated ${result.inserted} auto-accrual ${result.inserted === 1 ? "row" : "rows"} across closed periods — $${earned.toLocaleString(undefined, { maximumFractionDigits: 2 })} earned.`,
      )
      if (result.volumeTermsMissingCpt.length > 0) {
        toast.warning(
          `Skipped volume terms (no CPT codes): ${result.volumeTermsMissingCpt.join(", ")}. Edit the contract and add CPT codes on each term so the engine can count procedure occurrences from Case Costing.`,
          { duration: 10_000 },
        )
      }
      if (result.carveOutTermsMissingPricing.length > 0) {
        toast.warning(
          `Carve-out terms missing pricing rates: ${result.carveOutTermsMissingPricing.join(", ")}. Set carveOutPercent on the contract's pricing rows so the engine can apply per-line carve-out rates.`,
          { duration: 10_000 },
        )
      }
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
          {supportsCreditPayment && (
            <Button
              size="sm"
              variant="outline"
              className="gap-2"
              onClick={() => setMode({ kind: "credit-or-payment" })}
            >
              <DollarSign className="h-4 w-4" />
              Log Credit / Payment
            </Button>
          )}
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
          earnedRows={earnedRows}
        />
      )}
    </>
  )
}

function TransactionTable({
  rows,
  filter,
  onAction,
}: {
  rows: PeriodRow[]
  filter: "all" | TransactionType
  onAction: (action: "edit" | "uncollect" | "delete", row: PeriodRow) => void
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
            <TableHead className="text-right">Earned</TableHead>
            <TableHead className="text-right">Collected</TableHead>
            <TableHead className="text-right">Outstanding</TableHead>
            <TableHead className="text-center">Status</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((row) => {
            // Charles W1.W-C1: Outstanding = max(Earned − Collected, 0)
            // on a single ledger row. F2-M1 fix: route Collected through
            // the canonical collectionDate gate so the per-row + summary
            // numbers agree.
            const collectedForDisplay = rebateCollectedForRow(row)
            const outstanding = Math.max(
              row.rebateEarned - collectedForDisplay,
              0,
            )
            const collection = getCollectionStatus(row)
            const collConfig = collectionStatusConfig[collection]
            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <div>
                    {formatCalendarDate(row.periodStart)} &ndash;{" "}
                    {formatCalendarDate(row.periodEnd)}
                  </div>
                  {row.collectionDate && (
                    <div className="text-xs font-normal text-muted-foreground">
                      collected {formatDate(row.collectionDate)}
                    </div>
                  )}
                  {/*
                   * Charles 2026-04-24 (Bug 13): audit sub-line showing
                   * when the row itself was logged. Distinct from the
                   * collection date (which is the business date a payment
                   * was received).
                   */}
                  {row.createdAt && (
                    <div className="text-xs font-normal text-muted-foreground">
                      logged {formatDate(row.createdAt)}
                    </div>
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="gap-1">
                    <ArrowUpRight className="h-3 w-3 text-emerald-600" />
                    Rebate
                  </Badge>
                </TableCell>
                <TableCell className="text-right text-emerald-600">
                  {formatCurrency(row.rebateEarned)}
                </TableCell>
                <TableCell className="text-right text-blue-600">
                  {formatCurrency(collectedForDisplay)}
                </TableCell>
                <TableCell
                  className={`text-right ${
                    outstanding > 0 ? "text-amber-600" : "text-muted-foreground"
                  }`}
                >
                  {formatCurrency(outstanding)}
                </TableCell>
                <TableCell className="text-center">
                  <Badge variant="outline" className={collConfig.className}>
                    {collConfig.label}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        aria-label="Row actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onAction("edit", row)}>
                        Edit
                      </DropdownMenuItem>
                      {row.collectionDate ? (
                        <DropdownMenuItem
                          onClick={() => onAction("uncollect", row)}
                        >
                          Uncollect
                        </DropdownMenuItem>
                      ) : null}
                      {!row.notes?.includes("[auto-accrual]") ? (
                        <>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            className="text-red-600 dark:text-red-400"
                            onClick={() => onAction("delete", row)}
                          >
                            Delete
                          </DropdownMenuItem>
                        </>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

export function ContractTransactions({ contractId, contractType }: ContractTransactionsProps) {
  const queryClient = useQueryClient()
  const [activeTab, setActiveTab] = useState<"all" | TransactionType>("all")
  // Charles W1.X-A: selected row for the Edit dialog. `null` = closed.
  const [editRow, setEditRow] = useState<PeriodRow | null>(null)

  // Charles W1.P: the ledger's only data source is the `Rebate` table.
  // Engine-generated accrual rows (via Recompute Earned Rebates) and
  // user-logged collections / credits / payments both land here, so the
  // query covers every surface the user expects in the ledger.
  const { data: rebatesData, isLoading: rebatesLoading } = useQuery({
    queryKey: ["contractRebates", contractId],
    queryFn: () => getContractRebates(contractId),
    enabled: !!contractId,
  })

  // Charles W1.X-A: row-level mutations for the actions dropdown.
  // Invalidate the same four keys as `createContractTransaction` so
  // the summary cards (Earned / Collected / Outstanding), the ledger
  // itself, and the contract-detail header refresh atomically after
  // every edit. Without the explicit invalidate the user would see
  // stale numbers until the next tab flip.
  function invalidateLedger() {
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
  }

  const uncollect = useMutation({
    mutationFn: async (row: PeriodRow) => {
      await updateContractTransaction({
        id: row.id,
        contractId,
        rebateCollected: 0,
        collectionDate: null,
      })
    },
    onSuccess: () => {
      toast.success("Collection removed")
      invalidateLedger()
    },
    onError: () => toast.error("Failed to remove collection"),
  })

  const del = useMutation({
    mutationFn: async (row: PeriodRow) => {
      await deleteContractTransaction({ id: row.id, contractId })
    },
    onSuccess: () => {
      toast.success("Row deleted")
      invalidateLedger()
    },
    onError: (err: Error) => toast.error(err.message || "Failed to delete"),
  })

  function handleAction(
    action: "edit" | "uncollect" | "delete",
    row: PeriodRow,
  ) {
    if (action === "uncollect") {
      uncollect.mutate(row)
      return
    }
    if (action === "delete") {
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          `Delete ledger row for ${row.periodStart}–${row.periodEnd}?`,
        )
      ) {
        return
      }
      del.mutate(row)
      return
    }
    if (action === "edit") {
      setEditRow(row)
      return
    }
  }

  if (rebatesLoading) {
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

  // Rebate rows are the ledger's single source of truth (Charles W1.P).
  // Engine-driven accrual rows (Recompute) and manual-entry rows
  // (Log Collected Rebate, Log Credit / Payment) are both stored in
  // `Rebate`, so this one query covers every visible transaction. The
  // mapping + newest-first sort is factored into
  // `contract-transactions-display.ts` so it can be unit-tested without
  // spinning up React.
  const rows: PeriodRow[] = mapRebateRowsToLedger(
    (rebatesData ?? []) as Array<Record<string, unknown>>,
  )

  // Lifetime earned rebates across every CLOSED period on this contract
  // (Charles R5.27). "Closed" means payPeriodEnd <= today — applied to
  // every Rebate row so the number matches the scope advertised in the
  // tooltip below, and stays distinct from the header's
  // "Rebates Earned (YTD)" card. Charles W1.P: ContractPeriod rollups
  // are no longer summed here. Charles W1.U-B: delegated to the
  // canonical `sumEarnedRebatesLifetime` helper so this surface and
  // the detail header card are guaranteed to apply the same rule.
  const totalRebates = sumEarnedRebatesLifetime(
    rows.map((r) => ({
      payPeriodEnd: r.periodEnd,
      rebateEarned: r.rebateEarned,
    })),
  )
  // Charles W1.N / W1.R: "Total Collected" delegates to the canonical
  // `sumCollectedRebates` helper — the same filter powers the contract
  // detail header card and the contracts list row, so these surfaces
  // can never drift. After W1.P every ledger row is a Rebate row, so
  // we can call the base helper directly.
  const totalCollected = sumCollectedRebates(
    rows.map((r) => ({
      collectionDate: r.collectionDate ?? null,
      rebateCollected: r.rebateCollected,
    })),
  )
  // Charles W1.W-C1: Outstanding = sum(max(Earned − Collected, 0))
  // across all ledger rows. The summary card mirrors the table column
  // and replaces the old "Total Payments" card (which was hardcoded $0
  // post-W1.P and now lives in the credit/payment ledger, out of scope
  // for this card).
  // F2-M1: route Collected through the canonical collectionDate gate
  // so the summary matches the per-row column (which also uses
  // rebateCollectedForRow). Pre-fix the summary undercounted Outstanding
  // when rebateCollected was populated without collectionDate.
  const totalOutstanding = rows.reduce(
    (acc, r) =>
      acc +
      Math.max(r.rebateEarned - rebateCollectedForRow(r), 0),
    0,
  )

  // Charles W1.W-C1: earned-uncollected rows fed to the Log-Collected-
  // Rebate dialog's period dropdown. Ordered oldest-first so the user
  // sees the most-delinquent period at the top of the dropdown.
  const earnedRows = rows
    .filter((r) => r.rebateEarned > 0 && !r.collectionDate)
    .slice()
    .sort(
      (a, b) => new Date(a.periodEnd).getTime() - new Date(b.periodEnd).getTime(),
    )

  if (rows.length === 0) {
    // Charles W1.P: empty state. No ledger table; just a muted card
    // pointing the user to the Recompute button that now lives
    // alongside this section.
    return (
      <Card data-testid="contract-transactions-empty" className="bg-muted/40">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Calendar className="h-4 w-4" />
            Transaction Ledger
          </CardTitle>
          <AddTransactionButtons
            contractId={contractId}
            contractType={contractType}
            queryClient={queryClient}
            earnedRows={earnedRows}
          />
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No rebate transactions yet. Click{" "}
            <strong>Recompute Earned Rebates</strong> above to generate
            rebates from your contract&apos;s terms + COG spend.
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
        {/* Charles W1.W-C1: Outstanding card replaces the legacy
            "Total Payments" card (which was hardcoded to $0 post-W1.P).
            Outstanding = Earned − Collected, summed across every ledger
            row — the single number that tells the user how much rebate
            money is still owed by the vendor. */}
        <Card>
          <CardContent className="flex items-center justify-between gap-3 pt-6">
            <div>
              <p className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                Outstanding
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="inline-flex cursor-help items-center">
                        <HelpCircle
                          className="h-3.5 w-3.5 text-muted-foreground"
                          aria-label="Outstanding help"
                        />
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[320px] p-3 text-xs">
                      <p>
                        Earned rebate that has not yet been collected from
                        the vendor. Computed per period as Earned − Collected
                        and summed across every ledger row.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </p>
              <p className="text-2xl font-bold text-amber-600">
                {formatCurrency(totalOutstanding)}
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
          <AddTransactionButtons
            contractId={contractId}
            contractType={contractType}
            queryClient={queryClient}
            earnedRows={earnedRows}
          />
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
                  types are first-class; every row in `rows` is sourced
                  from the Rebate table post W1.P. */}
            </TabsList>

            <TabsContent value={activeTab} className="m-0">
              <TransactionTable
                rows={rows}
                filter={activeTab}
                onAction={handleAction}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
      <EditTransactionDialog
        contractId={contractId}
        queryClient={queryClient}
        row={editRow}
        open={editRow !== null}
        onOpenChange={(next) => {
          if (!next) setEditRow(null)
        }}
      />
    </div>
  )
}
