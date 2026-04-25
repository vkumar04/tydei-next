"use client"

import { useState } from "react"
import type { PendingContract, Vendor } from "@prisma/client"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { Loader2 } from "lucide-react"

type PendingContractWithVendor = PendingContract & {
  vendor: Pick<Vendor, "id" | "name" | "logoUrl">
}

interface PendingReviewDialogProps {
  contract: PendingContractWithVendor
  open: boolean
  onOpenChange: (open: boolean) => void
  onApprove: () => void
  onReject: (notes: string) => void
  onRequestRevision: (notes: string) => void
  isSubmitting: boolean
}

export function PendingReviewDialog({
  contract, open, onOpenChange, onApprove, onReject, onRequestRevision, isSubmitting,
}: PendingReviewDialogProps) {
  const [tab, setTab] = useState("details")
  const [notes, setNotes] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review: {contract.contractName}
            <Badge variant="secondary">Pending</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="action">Action</TabsTrigger>
          </TabsList>

          <TabsContent
            value="details"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm"
          >
            <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{contract.vendor.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{contract.contractType.replace("_", " ")}</span></div>
            {contract.effectiveDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Effective</span><span>{formatCalendarDate(contract.effectiveDate)}</span></div>
            )}
            {contract.expirationDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Expiration</span><span>{formatCalendarDate(contract.expirationDate)}</span></div>
            )}
            {contract.totalValue && (
              <div className="flex justify-between"><span className="text-muted-foreground">Value</span><span>{formatCurrency(Number(contract.totalValue))}</span></div>
            )}
            {/*
             * Charles 2026-04-25 (audit follow-up — vendor-mirror
             * Phase 2): surface the field-parity columns the vendor
             * may have submitted so the facility approver can see
             * everything they're approving. Each row is conditional
             * on the field being set so the dialog doesn't bloat
             * with empty rows on legacy submissions.
             */}
            {contract.contractNumber && (
              <div className="flex justify-between"><span className="text-muted-foreground">Contract #</span><span>{contract.contractNumber}</span></div>
            )}
            {contract.annualValue != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Annual Value</span><span>{formatCurrency(Number(contract.annualValue))}</span></div>
            )}
            {contract.gpoAffiliation && (
              <div className="flex justify-between"><span className="text-muted-foreground">GPO</span><span>{contract.gpoAffiliation}</span></div>
            )}
            {contract.performancePeriod && (
              <div className="flex justify-between"><span className="text-muted-foreground">Performance period</span><span className="capitalize">{contract.performancePeriod}</span></div>
            )}
            {contract.rebatePayPeriod && (
              <div className="flex justify-between"><span className="text-muted-foreground">Rebate pay period</span><span className="capitalize">{contract.rebatePayPeriod}</span></div>
            )}
            {contract.autoRenewal && (
              <div className="flex justify-between"><span className="text-muted-foreground">Auto-renewal</span><span>Yes</span></div>
            )}
            {contract.terminationNoticeDays != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Termination notice</span><span>{contract.terminationNoticeDays} days</span></div>
            )}
            {contract.capitalCost != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Capital cost</span><span>{formatCurrency(Number(contract.capitalCost))}</span></div>
            )}
            {contract.interestRate != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Interest rate</span><span>{(Number(contract.interestRate) * 100).toFixed(2)}%</span></div>
            )}
            {contract.termMonths != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Term</span><span>{contract.termMonths} months</span></div>
            )}
            {contract.downPayment != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Down payment</span><span>{formatCurrency(Number(contract.downPayment))}</span></div>
            )}
            {contract.paymentCadence && (
              <div className="flex justify-between"><span className="text-muted-foreground">Payment cadence</span><span className="capitalize">{contract.paymentCadence}</span></div>
            )}
            {contract.amortizationShape && (
              <div className="flex justify-between"><span className="text-muted-foreground">Amortization</span><span className="capitalize">{contract.amortizationShape}</span></div>
            )}
            {contract.notes && (
              <div>
                <p className="text-muted-foreground">Notes</p>
                <p className="mt-1">{contract.notes}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent
            value="action"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto"
          >
            <Textarea
              placeholder="Review notes (required for reject / revision)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={onApprove} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => onRequestRevision(notes)}
                disabled={isSubmitting || !notes.trim()}
              >
                Request Revision
              </Button>
              <Button
                variant="destructive"
                onClick={() => onReject(notes)}
                disabled={isSubmitting || !notes.trim()}
              >
                Reject
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
