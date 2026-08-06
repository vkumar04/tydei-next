"use client"

import { HelpCircle, AlertTriangle } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TermFormValues } from "@/lib/validators/contract-terms"

interface TermTieInFieldsProps {
  term: TermFormValues
  /** Contract type from the parent contract — the card only renders
   *  this block when it's "tie_in"; the value is still threaded through
   *  for the commitment-floor copy below. */
  contractType?: string
  onUpdate: (updated: Partial<TermFormValues>) => void
}

export function TermTieInFields({
  term,
  contractType,
  onUpdate,
}: TermTieInFieldsProps) {
  return (
    <div className="space-y-5 rounded-md border p-4">
      {/* Charles W1.T — tie-in capital is contract-level now.
          Capital cost / interest / term / cadence / shape
          render once ABOVE the terms list in
          ContractCapitalEntry. This block keeps only the
          per-term consumable commitment + shortfall fields. */}

      {/* Per-term: Consumable Commitment & Shortfall */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold">
            Consumable Commitment &amp; Shortfall
          </h4>
          <p className="text-xs text-muted-foreground">
            The usage side — how much spend the facility
            commits to, and what happens if they fall short.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="inline-flex items-center gap-1">
              Minimum Annual Purchase ($)
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center">
                      <HelpCircle
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label="Minimum annual purchase help"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] p-3 text-xs">
                    <p>
                      Hospital&apos;s annual consumable spend
                      commitment. If actual spend falls short,
                      the shortfall-handling policy (see
                      Wave C) decides whether the vendor bills
                      the gap or carries it forward.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Input
              type="number"
              value={term.minimumPurchaseCommitment ?? ""}
              onChange={(e) =>
                onUpdate({
                  minimumPurchaseCommitment:
                    e.target.value === ""
                      ? null
                      : Number(e.target.value),
                })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              {contractType === "tie_in"
                ? "Floor. If 12-month spend falls below this, the contract will not retire its capital on schedule. Drives the at-risk badge on the Capital Amortization card."
                : "Reference only — not enforced in rebate math today."}
            </p>
            <p className="text-[11px] text-muted-foreground">
              If left blank, the term baseline is used as the minimum annual purchase floor.
            </p>
            {(term.minimumPurchaseCommitment == null ||
              term.minimumPurchaseCommitment === 0) && (
              <p className="inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  No minimum purchase commitment entered —
                  the rebate paydown won&apos;t have a floor
                  to run against.
                </span>
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label className="inline-flex items-center gap-1">
              Shortfall Handling
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent className="max-w-xs">
                    What happens when consumable spend falls
                    below the minimum annual purchase
                    commitment.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Select
              value={term.shortfallHandling ?? "carry_forward"}
              onValueChange={(value) =>
                onUpdate({
                  shortfallHandling:
                    value === "bill_immediately" ||
                    value === "carry_forward"
                      ? value
                      : null,
                })
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select shortfall handling" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="carry_forward">
                  Carry forward — apply the shortfall to the
                  next period&apos;s commitment
                </SelectItem>
                <SelectItem value="bill_immediately">
                  Bill immediately — invoice the shortfall at
                  period close
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>

    </div>
  )
}
