"use client"

import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { DialogFooter } from "@/components/ui/dialog"

export interface DialogFooterActionsProps {
  lineItemCount: number
  isPending: boolean
  onCancel: () => void
  onSaveDraft: () => void
  onSubmit: () => void
}

export function DialogFooterActions({
  lineItemCount,
  isPending,
  onCancel,
  onSaveDraft,
  onSubmit,
}: DialogFooterActionsProps) {
  return (
    <DialogFooter className="gap-2">
      <Button variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button
        variant="secondary"
        onClick={onSaveDraft}
        disabled={lineItemCount === 0 || isPending}
      >
        {isPending && <Loader2 className="animate-spin" />}
        Save as Draft
      </Button>
      <Button
        onClick={onSubmit}
        disabled={lineItemCount === 0 || isPending}
      >
        {isPending && <Loader2 className="animate-spin" />}
        Submit PO
      </Button>
    </DialogFooter>
  )
}
