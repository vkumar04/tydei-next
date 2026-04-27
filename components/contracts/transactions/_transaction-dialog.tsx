"use client"

import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { DollarSign } from "lucide-react"
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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "sonner"

// Charles R5.34-b / W1.K: two explicit modes; no generic kind selector.
// "rebate-collected" → type=rebate, rebateKind=collected
// "credit-or-payment" → type=credit|payment, rebateKind=undefined
export type DialogMode =
  | { kind: "rebate-collected" }
  | { kind: "credit-or-payment" }

export function dialogTitle(mode: DialogMode): string {
  if (mode.kind === "rebate-collected") return "Log Collected Rebate"
  return "Log Credit or Payment"
}

export function dialogDescription(mode: DialogMode): string {
  if (mode.kind === "rebate-collected")
    return "Records a payment received from the vendor. Adds to Rebates Collected only — does NOT add to Rebates Earned."
  return "Records a credit memo or vendor payment against this contract."
}

// Charles W1.W-C1: Per-row "Collected" amount — gates on collectionDate per
// the canonical sumCollectedRebates rule.
function rebateCollectedForRow(row: PeriodRow): number {
  return row.collectionDate ? row.rebateCollected : 0
}

// Subset of PeriodRow fields this dialog needs. Matches the shape defined
// in contract-transactions.tsx — duplicated here so the file is self-contained.
export interface PeriodRow {
  id: string
  periodStart: string
  periodEnd: string
  rebateEarned: number
  rebateCollected: number
  collectionDate?: string | null
}

type TransactionType = "rebate" | "credit" | "payment"
type RebateKind = "earned" | "collected"

export function TransactionDialog({
  contractId,
  queryClient,
  mode,
  open,
  onOpenChange,
  earnedRows,
}: {
  contractId: string
  queryClient: ReturnType<typeof useQueryClient>
  mode: DialogMode
  open: boolean
  onOpenChange: (open: boolean) => void
  // Charles W1.W-C1: earned-uncollected rows shown in the period
  // dropdown so the user picks WHICH earned period this collection
  // pays down. Empty → out-of-band fallback path on the server.
  earnedRows: PeriodRow[]
}) {
  // For the credit/payment dialog only, let the user pick which of the two.
  const [cpType, setCpType] = useState<"credit" | "payment">("credit")
  const [amount, setAmount] = useState("")
  const [description, setDescription] = useState("")
  const [date, setDate] = useState("")
  const [quantity, setQuantity] = useState("")
  // Charles W1.W-C1: "auto" = let the server auto-match the oldest
  // uncollected earned row. Otherwise carries the Rebate row id the
  // user picked.
  const [rebateId, setRebateId] = useState<string>("auto")

  function reset() {
    setCpType("credit")
    setAmount("")
    setDescription("")
    setDate("")
    setQuantity("")
    setRebateId("auto")
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
        // Charles W1.W-C1: on a rebate-collected dialog, pass the picked
        // earned row (or undefined for "auto" → server auto-matches
        // oldest earned-uncollected).
        rebateId:
          mode.kind === "rebate-collected" && rebateId !== "auto"
            ? rebateId
            : undefined,
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
          {mode.kind === "rebate-collected" && (
            <div className="space-y-2">
              <Label htmlFor="txn-period">Earned Period *</Label>
              <Select value={rebateId} onValueChange={setRebateId}>
                <SelectTrigger id="txn-period">
                  <SelectValue placeholder="Pick the period this payment covers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    Auto-match oldest uncollected earned period
                  </SelectItem>
                  {earnedRows.map((r) => {
                    const outstanding = Math.max(
                      r.rebateEarned - rebateCollectedForRow(r),
                      0,
                    )
                    return (
                      <SelectItem key={r.id} value={r.id}>
                        {formatCalendarDate(r.periodStart)} – {formatCalendarDate(r.periodEnd)}{" "}
                        · earned {formatCurrency(r.rebateEarned)} · outstanding{" "}
                        {formatCurrency(outstanding)}
                      </SelectItem>
                    )
                  })}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Picks the earned Rebate row to stamp collected. If no earned
                row matches, the collection is logged as an out-of-band entry.
              </p>
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
