"use client"

import { HelpCircle, Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import type { TierInput } from "@/lib/validators/contract-terms"
import {
  fromDisplayRebateValue,
  isPercentRebateType,
  toDisplayRebateValue,
} from "@/lib/contracts/rebate-value-normalize"

interface ContractTierRowProps {
  tier: TierInput
  index: number
  onChange: (tier: TierInput) => void
  onRemove: () => void
  /**
   * Charles 2026-04-25 audit C5: parent term's termType so the
   * Min/Max labels read "Occurrences"/"PO Count"/"Invoices"/"% Achieved"
   * for non-spend ladders instead of the misleading "Spend Min/Max".
   */
  termType?: string
}

function thresholdLabels(termType: string | undefined): { min: string; max: string | null; suffix?: string } {
  switch (termType) {
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
      return { min: "Min Occurrences", max: "Max Occurrences" }
    case "po_rebate":
      return { min: "Min PO Count", max: "Max PO Count" }
    case "payment_rebate":
      return { min: "Min Invoices", max: "Max Invoices" }
    // Charles 2026-04-25 audit re-pass F3 — for threshold-style
    // payouts (compliance / market_share) the engine matches tiers
    // EXCLUSIVE-style. If both Min and Max % are set and the metric
    // value lands above the highest tier's spendMax, the tier match
    // returns null and the row silently pays $0. Render Min only;
    // spendMax stays null which the engine treats as +∞.
    case "compliance_rebate":
    case "market_share":
      return { min: "Threshold % Achieved", max: null, suffix: "%" }
    case "fixed_fee":
      return { min: "Threshold", max: "Cap" }
    default:
      return { min: "Spend Min", max: "Spend Max" }
  }
}

const rebateTypes = [
  { value: "percent_of_spend", label: "% of Spend" },
  { value: "fixed_rebate", label: "Fixed Rebate" },
  { value: "fixed_rebate_per_unit", label: "Fixed / Unit" },
  { value: "per_procedure_rebate", label: "Per Procedure" },
] as const

export function ContractTierRow({
  tier,
  index,
  onChange,
  onRemove,
  termType,
}: ContractTierRowProps) {
  const isPercent = isPercentRebateType(tier.rebateType)
  const labels = thresholdLabels(termType)

  // The DB stores percent_of_spend as a fraction (0.03 = 3%) but we
  // want the user to type plain percent. Charles R5.25: typing "3"
  // here used to save as 3, which the rebate engine treated as 300%
  // because it scales × 100 at the Prisma boundary. We denormalize on
  // load and re-normalize on save so the on-wire model stays a
  // fraction while the input stays percent.
  const displayValue = toDisplayRebateValue(tier.rebateType, tier.rebateValue)

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
      <span className="flex h-9 items-center text-xs font-medium text-muted-foreground">
        Tier {index + 1}
      </span>

      {/* Charles audit round-4 vendor BLOCKER: tierName has no UI
          input anywhere. The schema + hydrate + approve all carry
          the field but the form never let the user populate it.
          Optional friendly label like "Bronze / Silver / Gold". */}
      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Label (optional)</label>
        <Input
          className="w-28"
          placeholder="Bronze"
          value={tier.tierName ?? ""}
          onChange={(e) =>
            onChange({
              ...tier,
              tierName: e.target.value || null,
            })
          }
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">{labels.min}</label>
        <div className="relative">
          <Input
            type="number"
            className={labels.suffix ? "w-28 pr-7" : "w-28"}
            value={tier.spendMin}
            onChange={(e) =>
              onChange({ ...tier, spendMin: Number(e.target.value) })
            }
          />
          {labels.suffix && (
            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              {labels.suffix}
            </span>
          )}
        </div>
      </div>

      {labels.max && (
        <div className="space-y-1">
          <label className="text-xs text-muted-foreground">{labels.max}</label>
          <div className="relative">
            <Input
              type="number"
              className={labels.suffix ? "w-28 pr-7" : "w-28"}
              value={tier.spendMax ?? ""}
              onChange={(e) =>
                onChange({
                  ...tier,
                  spendMax: e.target.value ? Number(e.target.value) : undefined,
                })
              }
            />
            {labels.suffix && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                {labels.suffix}
              </span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Rebate Type</label>
        <Select
          value={tier.rebateType}
          onValueChange={(v) => {
            const nextType = v as TierInput["rebateType"]
            // When toggling between percent and dollar modes, re-map
            // the stored value so the displayed number stays the
            // user's intent. E.g. switching from "3% of spend" (stored
            // 0.03) to "fixed $3" should land on 3, not 0.03.
            const nextStoredValue = fromDisplayRebateValue(
              nextType,
              toDisplayRebateValue(tier.rebateType, tier.rebateValue),
            )
            onChange({
              ...tier,
              rebateType: nextType,
              rebateValue: nextStoredValue,
            })
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rebateTypes.map((rt) => (
              <SelectItem key={rt.value} value={rt.value}>
                {rt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground flex items-center gap-1">
          {isPercent ? "Rebate %" : "Rebate $"}
          {isPercent && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex cursor-help items-center">
                    <HelpCircle
                      className="h-3 w-3 text-muted-foreground"
                      aria-label="Enter as a percent"
                    />
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-[220px] p-2 text-xs">
                  Enter as a percent (e.g. 2 = 2%).
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </label>
        <div className="relative w-28">
          <Input
            type="number"
            step={isPercent ? "0.1" : "0.01"}
            min="0"
            max={isPercent ? "100" : undefined}
            className={isPercent ? "pr-6" : undefined}
            value={displayValue}
            onChange={(e) => {
              const raw = Number(e.target.value)
              onChange({
                ...tier,
                rebateValue: fromDisplayRebateValue(tier.rebateType, raw),
              })
            }}
          />
          {isPercent && (
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          )}
        </div>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
