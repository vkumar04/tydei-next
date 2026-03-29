"use client"

import { useState } from "react"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"

interface DisputeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (notes: string) => void
  itemDescription: string
}

export function DisputeDialog({ open, onOpenChange, onSubmit, itemDescription }: DisputeDialogProps) {
  const [notes, setNotes] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Flag Discrepancy</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Flagging: <span className="font-medium text-foreground">{itemDescription}</span>
        </p>
        <Textarea
          placeholder="Add dispute notes..."
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => { onSubmit(notes); onOpenChange(false) }}>
            Flag Item
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
