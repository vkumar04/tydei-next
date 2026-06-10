import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { poStatusConfig } from "./types"
import type { VendorPORow } from "./types"

export interface POViewDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedPO: VendorPORow | null
}

export function POViewDialog({ open, onOpenChange, selectedPO }: POViewDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Purchase Order Details</DialogTitle>
          <DialogDescription>
            {selectedPO?.poNumber} - {selectedPO?.facilityName}
          </DialogDescription>
        </DialogHeader>
        {selectedPO && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Status</p>
                <Badge
                  className={
                    poStatusConfig[selectedPO.status]?.color ?? "bg-muted text-muted-foreground"
                  }
                >
                  {poStatusConfig[selectedPO.status]?.label ?? selectedPO.status}
                </Badge>
              </div>
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-lg font-bold">{formatCurrency(selectedPO.totalCost)}</p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Facility</p>
                <p className="font-medium">{selectedPO.facilityName}</p>
              </div>
              <div>
                <p className="text-muted-foreground">Order Date</p>
                {/* M6: orderDate is a @db.Date — UTC-pinned formatter */}
                <p className="font-medium">{formatCalendarDate(selectedPO.orderDate)}</p>
              </div>
            </div>
          </div>
        )}
        {/* L18 (2026-06-09 audit): the "Acknowledge Order" button was a
            no-op, and status transitions are facility-owned (updatePOStatus
            is requireFacility-gated) — removed rather than wired. */}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
