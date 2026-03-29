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
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

interface SpendTargetDialogProps {
  opportunity: RebateOpportunity | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSave: (target: number, date: string) => Promise<void>
}

export function SpendTargetDialog({
  opportunity,
  open,
  onOpenChange,
  onSave,
}: SpendTargetDialogProps) {
  const [targetSpend, setTargetSpend] = useState("")
  const [targetDate, setTargetDate] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSave() {
    if (!targetSpend || !targetDate) return
    setLoading(true)
    try {
      await onSave(Number(targetSpend), targetDate)
      onOpenChange(false)
      setTargetSpend("")
      setTargetDate("")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Set Spend Target</DialogTitle>
          <DialogDescription>
            {opportunity
              ? `Set a spend target for ${opportunity.contractName} to reach Tier ${opportunity.nextTier}`
              : "Set a spend target"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          {opportunity && (
            <div className="rounded-md bg-muted p-3 text-sm">
              <p>
                <span className="text-muted-foreground">Next Tier Threshold: </span>
                <span className="font-medium">${opportunity.nextTierThreshold.toLocaleString()}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Spend Gap: </span>
                <span className="font-medium text-amber-500">${opportunity.spendGap.toLocaleString()}</span>
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="target-spend">Target Spend ($)</Label>
            <Input
              id="target-spend"
              type="number"
              placeholder={opportunity?.nextTierThreshold.toString()}
              value={targetSpend}
              onChange={(e) => setTargetSpend(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="target-date">Target Date</Label>
            <Input
              id="target-date"
              type="date"
              value={targetDate}
              onChange={(e) => setTargetDate(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={loading || !targetSpend || !targetDate}>
            {loading ? "Saving..." : "Set Target"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
