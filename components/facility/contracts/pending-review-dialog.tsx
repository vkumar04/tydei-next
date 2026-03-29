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
import { formatCurrency, formatDate } from "@/lib/formatting"
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
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review: {contract.contractName}
            <Badge variant="secondary">Pending</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="action">Action</TabsTrigger>
          </TabsList>

          <TabsContent value="details" className="space-y-3 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{contract.vendor.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{contract.contractType.replace("_", " ")}</span></div>
            {contract.effectiveDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Effective</span><span>{formatDate(contract.effectiveDate)}</span></div>
            )}
            {contract.expirationDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Expiration</span><span>{formatDate(contract.expirationDate)}</span></div>
            )}
            {contract.totalValue && (
              <div className="flex justify-between"><span className="text-muted-foreground">Value</span><span>{formatCurrency(Number(contract.totalValue))}</span></div>
            )}
            {contract.notes && (
              <div>
                <p className="text-muted-foreground">Notes</p>
                <p className="mt-1">{contract.notes}</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="action" className="space-y-4">
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
