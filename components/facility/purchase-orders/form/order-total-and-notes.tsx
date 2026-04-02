"use client"

import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface OrderTotalAndNotesProps {
  total: number
  lineItemCount: number
  specialInstructions: string
  poNotes: string
  onSpecialInstructionsChange: (value: string) => void
  onPONotesChange: (value: string) => void
}

export function OrderTotalAndNotes({
  total,
  lineItemCount,
  specialInstructions,
  poNotes,
  onSpecialInstructionsChange,
  onPONotesChange,
}: OrderTotalAndNotesProps) {
  return (
    <>
      {/* Total */}
      {lineItemCount > 0 && (
        <div className="flex justify-end">
          <div className="bg-muted p-4 rounded-lg">
            <div className="flex items-center gap-4">
              <span className="text-muted-foreground">Order Total:</span>
              <span className="text-2xl font-bold">
                ${total.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Special Instructions & Notes */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Special Instructions</Label>
          <Input
            value={specialInstructions}
            onChange={(e) => onSpecialInstructionsChange(e.target.value)}
            placeholder="e.g., Deliver to Loading Dock B"
          />
        </div>
        <div className="space-y-2">
          <Label>Internal Notes</Label>
          <Input
            value={poNotes}
            onChange={(e) => onPONotesChange(e.target.value)}
            placeholder="Internal notes (not sent to vendor)"
          />
        </div>
      </div>
    </>
  )
}
