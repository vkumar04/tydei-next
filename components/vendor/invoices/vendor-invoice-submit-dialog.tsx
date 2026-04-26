"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { DollarSign, Send } from "lucide-react"
import { toast } from "sonner"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { submitVendorInvoice } from "@/lib/actions/vendor-invoices"
import { getVendorFacilities } from "@/lib/actions/vendor-purchase-orders"

export interface VendorInvoiceSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface SubmitForm {
  invoiceNumber: string
  facilityId: string
  amount: string
  notes: string
}

const EMPTY_FORM: SubmitForm = {
  invoiceNumber: "",
  facilityId: "",
  amount: "",
  notes: "",
}

export function VendorInvoiceSubmitDialog({
  open,
  onOpenChange,
}: VendorInvoiceSubmitDialogProps) {
  const [form, setForm] = useState<SubmitForm>(EMPTY_FORM)
  const queryClient = useQueryClient()

  // Pull the vendor's facilities — server-scoped to the caller's vendor
  // so the dropdown can't expose other vendors' relationships.
  const { data: facilities = [] } = useQuery({
    queryKey: ["vendor-facilities"],
    queryFn: () => getVendorFacilities(),
    enabled: open,
  })

  const submit = useMutation({
    mutationFn: submitVendorInvoice,
    onSuccess: () => {
      toast.success("Invoice submitted")
      queryClient.invalidateQueries({ queryKey: ["vendor-invoices"] })
      onOpenChange(false)
      setForm(EMPTY_FORM)
    },
    onError: (err) => {
      toast.error(
        err instanceof Error ? err.message : "Failed to submit invoice",
      )
    },
  })

  function handleSubmit() {
    const amount = Number(form.amount)
    if (!form.invoiceNumber || !form.facilityId || !Number.isFinite(amount) || amount <= 0) {
      toast.error("Please fill in invoice number, facility, and a positive amount.")
      return
    }
    submit.mutate({
      invoiceNumber: form.invoiceNumber,
      facilityId: form.facilityId,
      totalAmount: amount,
      notes: form.notes || undefined,
    })
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
            <Label htmlFor="facility-id">Facility</Label>
            <Select
              value={form.facilityId}
              onValueChange={(value) =>
                setForm((f) => ({ ...f, facilityId: value }))
              }
            >
              <SelectTrigger id="facility-id">
                <SelectValue placeholder={
                  facilities.length === 0
                    ? "No facilities available — you must have a contract or PO with a facility before invoicing."
                    : "Select a facility"
                } />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
            <Textarea
              id="invoice-notes"
              placeholder="Additional notes or reference numbers"
              rows={2}
              value={form.notes}
              onChange={(e) =>
                setForm((f) => ({ ...f, notes: e.target.value }))
              }
            />
          </div>

          <div className="rounded-lg bg-muted/50 border p-3">
            <p className="text-xs text-muted-foreground">
              After submission, your invoice will be validated against
              contracted pricing. You will be notified of any discrepancies
              that require attention.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submit.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submit.isPending ||
              !form.invoiceNumber ||
              !form.facilityId ||
              !form.amount
            }
          >
            <Send className="mr-2 h-4 w-4" />
            {submit.isPending ? "Submitting…" : "Submit Invoice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
