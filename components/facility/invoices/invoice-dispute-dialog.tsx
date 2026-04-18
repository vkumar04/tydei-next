"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { AlertTriangle, Info } from "lucide-react"
import {
  useFlagInvoiceAsDisputed,
  useResolveInvoiceDispute,
} from "@/hooks/use-invoices"

// ─── Types ──────────────────────────────────────────────────────
//
// Invoice-level dispute dialog. Distinct from the line-item dispute
// dialog (`dispute-dialog.tsx`) — this action flags the entire invoice
// via `flagInvoiceAsDisputed`, per data-pipeline spec §4.3.

type DisputeStatus = "none" | "disputed" | "resolved" | "rejected"

interface InvoiceDisputeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  invoiceId: string
  invoiceNumber: string
  vendorName: string
  currentStatus: DisputeStatus
  existingNote?: string | null
  onCompleted?: () => void
}

// ─── Component ──────────────────────────────────────────────────

export function InvoiceDisputeDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceNumber,
  vendorName,
  currentStatus,
  existingNote,
  onCompleted,
}: InvoiceDisputeDialogProps) {
  const [note, setNote] = useState("")
  const flag = useFlagInvoiceAsDisputed()
  const resolve = useResolveInvoiceDispute()

  const isDisputed = currentStatus === "disputed"

  const handleFlag = () => {
    if (!note.trim()) return
    flag.mutate(
      { invoiceId, note: note.trim() },
      {
        onSuccess: () => {
          setNote("")
          onOpenChange(false)
          onCompleted?.()
        },
      }
    )
  }

  const handleResolve = (resolution: "resolved" | "rejected") => {
    resolve.mutate(
      {
        invoiceId,
        resolution,
        note: note.trim() ? note.trim() : undefined,
      },
      {
        onSuccess: () => {
          setNote("")
          onOpenChange(false)
          onCompleted?.()
        },
      }
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-500" />
            {isDisputed ? "Resolve Invoice Dispute" : "Flag Invoice as Disputed"}
          </DialogTitle>
          <DialogDescription>
            Invoice{" "}
            <span className="font-medium text-foreground">{invoiceNumber}</span>{" "}
            &middot; {vendorName}
          </DialogDescription>
        </DialogHeader>

        {/* Informational banner — spec §4.3 requires we disclose that
            vendor-side workflow isn't live yet. */}
        <div className="flex gap-2 rounded-md border border-blue-200 bg-blue-50 p-3 text-sm dark:border-blue-900 dark:bg-blue-950">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
          <div className="space-y-1 text-blue-900 dark:text-blue-100">
            <p className="font-medium">
              Vendor acknowledgment workflow coming soon
            </p>
            <p className="text-xs text-blue-800/90 dark:text-blue-200/90">
              Flagging sets internal status + writes an audit-trail entry.
              Vendor-side resolution + credit-memo flow ships in a later
              release.
            </p>
          </div>
        </div>

        {isDisputed && existingNote && (
          <div className="space-y-1 rounded-md border bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Badge variant="outline" className="text-[10px]">
                Existing note
              </Badge>
            </div>
            <p className="text-sm whitespace-pre-wrap">{existingNote}</p>
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="invoice-dispute-note">
            {isDisputed ? "Resolution note (optional)" : "Dispute note"}
          </Label>
          <Textarea
            id="invoice-dispute-note"
            placeholder={
              isDisputed
                ? "Describe how this dispute was resolved..."
                : "Describe the reason for the dispute (line items affected, expected contract pricing, etc.)..."
            }
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
          />
          {!isDisputed && (
            <p className="text-xs text-muted-foreground">
              Required &middot; minimum one character.
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={flag.isPending || resolve.isPending}
          >
            Cancel
          </Button>
          {isDisputed ? (
            <>
              <Button
                variant="outline"
                onClick={() => handleResolve("rejected")}
                disabled={resolve.isPending}
              >
                Reject
              </Button>
              <Button
                onClick={() => handleResolve("resolved")}
                disabled={resolve.isPending}
              >
                Mark Resolved
              </Button>
            </>
          ) : (
            <Button
              variant="destructive"
              onClick={handleFlag}
              disabled={!note.trim() || flag.isPending}
            >
              Flag as Disputed
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
