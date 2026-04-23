"use client"

import { useState } from "react"
import { DollarSign, Send } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface VendorInvoiceSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SubmitForm {
  invoiceNumber: string
  facilityName: string
  amount: string
  notes: string
}

const EMPTY_FORM: SubmitForm = {
  invoiceNumber: "",
  facilityName: "",
  amount: "",
  notes: "",
}

export function VendorInvoiceSubmitDialog({
  open,
  onOpenChange,
}: VendorInvoiceSubmitDialogProps) {
  const [form, setForm] = useState<SubmitForm>(EMPTY_FORM)

  function handleSubmit() {
    // In a real app this would call a server action
    onOpenChange(false)
    setForm(EMPTY_FORM)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Submit New Invoice</DialogTitle>
          <DialogDescription>
            Enter your invoice details below. The invoice will be submitted for
            validation against contracted pricing.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="invoice-number">Invoice Number</Label>
            <Input
              id="invoice-number"
              placeholder="e.g. INV-2026-001"
              value={form.invoiceNumber}
              onChange={(e) =>
                setForm((f) => ({ ...f, invoiceNumber: e.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="facility-name">Facility</Label>
            <Input
              id="facility-name"
              placeholder="Select or enter facility name"
              value={form.facilityName}
              onChange={(e) =>
                setForm((f) => ({ ...f, facilityName: e.target.value }))
              }
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-amount">Total Amount</Label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="invoice-amount"
                type="number"
                placeholder="0.00"
                className="pl-9"
                value={form.amount}
                onChange={(e) =>
                  setForm((f) => ({ ...f, amount: e.target.value }))
                }
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="invoice-notes">Notes (optional)</Label>
            <Input
              id="invoice-notes"
              placeholder="Additional notes or reference numbers"
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>

          <div className="rounded-lg bg-muted/50 border p-3">
            <p className="text-xs text-muted-foreground">
              After submission, your invoice will be automatically validated
              against contracted pricing. You will be notified of any
              discrepancies that require attention.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!form.invoiceNumber || !form.amount}
          >
            <Send className="mr-2 h-4 w-4" />
            Submit Invoice
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
