"use client"

import { useMemo } from "react"
import { Calculator, DollarSign } from "lucide-react"
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
import { formatCurrency } from "@/lib/formatting"
import type { RebateOpportunity } from "@/lib/actions/rebate-optimizer"

/**
 * Rebate calculator dialog — extracted from the old optimizer-client.
 * Given a contract and an "additional spend" amount, projects the new
 * tier, new rebate, and the uplift versus the current baseline.
 */
export interface RebateCalculatorDialogProps {
  open: boolean
  onOpenChange: (next: boolean) => void
  contract: RebateOpportunity | null
  additionalSpend: string
  onAdditionalSpendChange: (next: string) => void
}

export function RebateCalculatorDialog({
  open,
  onOpenChange,
  contract,
  additionalSpend,
  onAdditionalSpendChange,
}: RebateCalculatorDialogProps) {
  const result = useMemo(() => {
    if (!contract || !additionalSpend) return null
    const add = Number.parseFloat(additionalSpend)
    if (Number.isNaN(add) || add <= 0) return null
    const newSpend = contract.currentSpend + add
    const reachesNext = newSpend >= contract.nextTierThreshold
    const newTier = reachesNext ? contract.nextTier : contract.currentTier
    const newRebatePercent = reachesNext
      ? contract.nextRebatePercent
      : contract.currentRebatePercent
    const newRebate = (newSpend * newRebatePercent) / 100
    const oldRebate =
      (contract.currentSpend * contract.currentRebatePercent) / 100
    return {
      newSpend,
      newTier,
      newRebatePercent,
      newRebate,
      increase: newRebate - oldRebate,
    }
  }, [contract, additionalSpend])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Rebate Calculator
          </DialogTitle>
          <DialogDescription>
            {contract?.vendorName} — {contract?.contractName}
          </DialogDescription>
        </DialogHeader>

        {contract && (
          <div className="space-y-6">
            <div className="p-4 rounded-lg bg-muted/50">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Current Spend</p>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(contract.currentSpend)}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Current Tier</p>
                  <p className="font-medium">
                    Tier {contract.currentTier} ({contract.currentTier}%)
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Current Rebate</p>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(
                      (contract.currentSpend * contract.currentTier) / 100,
                    )}
                  </p>
                </div>
                <div>
                  <p className="text-muted-foreground">Next Tier</p>
                  <p className="font-medium tabular-nums">
                    {formatCurrency(contract.nextTierThreshold)} (
                    {contract.nextTier}%)
                  </p>
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="additional-spend">Additional Spend Amount</Label>
              <div className="relative">
                <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="additional-spend"
                  type="number"
                  placeholder="Enter amount…"
                  value={additionalSpend}
                  onChange={(e) => onAdditionalSpendChange(e.target.value)}
                  className="pl-9"
                />
              </div>
            </div>

            <div className="flex gap-2">
              {[50_000, 100_000, 250_000].map((amount) => (
                <Button
                  key={amount}
                  variant="outline"
                  size="sm"
                  onClick={() => onAdditionalSpendChange(amount.toString())}
                >
                  +{formatCurrency(amount)}
                </Button>
              ))}
            </div>

            {result && (
              <div className="p-4 rounded-lg border bg-muted/40">
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-3">
                  Projected Result
                </h4>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">New Total Spend</p>
                    <p className="font-medium tabular-nums">
                      {formatCurrency(result.newSpend)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">New Tier</p>
                    <p className="font-medium">
                      Tier {result.newTier} ({result.newRebatePercent}%)
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">New Rebate</p>
                    <p className="font-medium tabular-nums">
                      {formatCurrency(result.newRebate)}
                    </p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Increase</p>
                    <p className="font-medium tabular-nums text-emerald-600 dark:text-emerald-400">
                      +{formatCurrency(result.increase)}
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
