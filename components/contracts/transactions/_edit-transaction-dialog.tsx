"use client"

import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { updateContractTransaction } from "@/lib/actions/contract-periods"
import { queryKeys } from "@/lib/query-keys"
import { toast } from "sonner"

// Subset of PeriodRow fields this dialog needs. Matches the shape defined
// in contract-transactions.tsx — duplicated here so the file is self-contained.
export interface PeriodRow {
  id: string
  rebateCollected: number
  rebateEarned: number
  collectionDate?: string | null
  notes?: string | null
}

// Charles W1.X-A: edit dialog seeded from an existing ledger row. Only
// the collection side (amount / date / notes) is editable — rebateEarned
// is engine-owned and never touched from the UI. The dialog narrows to
// PeriodRow | null so we can render a single instance at the component
// root and drive its open state with a selected row.
export function EditTransactionDialog({
  contractId,
  queryClient,
  row,
  open,
  onOpenChange,
}: {
  contractId: string
  queryClient: ReturnType<typeof useQueryClient>
  row: PeriodRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [amount, setAmount] = useState("")
  const [earnedAmount, setEarnedAmount] = useState("")
  const [date, setDate] = useState("")
  const [notes, setNotes] = useState("")

  // Charles 2026-04-24 (Bug 13): let users correct manually-logged earned
  // amounts. Engine-generated rows carry `[auto-accrual]` in notes and
  // stay locked — no amount of UI convenience is worth letting a manual
  // typo overwrite a recompute result the user will regenerate anyway.
  const isManualRow = !row?.notes?.includes("[auto-accrual]")

  useEffect(() => {
    if (!row) return
    setAmount(String(row.rebateCollected ?? 0))
    setEarnedAmount(String(row.rebateEarned ?? 0))
    setDate(row.collectionDate ? row.collectionDate.slice(0, 10) : "")
    setNotes(row.notes ?? "")
  }, [row])

  async function handleSubmit() {
    if (!row) return
    const parsedAmount = parseFloat(amount.replace(/[^0-9.]/g, ""))
    if (isNaN(parsedAmount) || parsedAmount < 0) {
      toast.error("Enter a valid amount")
      return
    }
    let parsedEarned: number | undefined
    if (isManualRow) {
      parsedEarned = parseFloat(earnedAmount.replace(/[^0-9.]/g, ""))
      if (isNaN(parsedEarned) || parsedEarned < 0) {
        toast.error("Enter a valid earned amount")
        return
      }
    }
    try {
      await updateContractTransaction({
        id: row.id,
        contractId,
        rebateCollected: parsedAmount,
        ...(parsedEarned !== undefined && { rebateEarned: parsedEarned }),
        collectionDate: date || null,
        notes,
      })
      toast.success("Row updated")
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
      onOpenChange(false)
    } catch {
      toast.error("Failed to update row")
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Ledger Row</DialogTitle>
          <DialogDescription>
            {isManualRow
              ? "Update earned amount, collected amount, collection date, or notes."
              : "Update collected amount, collection date, or notes. Earned is engine-owned on auto-accrual rows — edit tiers and click Recompute to change it."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-4">
          {isManualRow && (
            <div className="space-y-2">
              <Label htmlFor="edit-earned">Earned Amount</Label>
              <Input
                id="edit-earned"
                value={earnedAmount}
                onChange={(e) => setEarnedAmount(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="edit-amount">Collected Amount</Label>
            <Input
              id="edit-amount"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-date">Collection Date</Label>
            <Input
              id="edit-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-notes">Notes</Label>
            <Input
              id="edit-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSubmit}>Save Changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
