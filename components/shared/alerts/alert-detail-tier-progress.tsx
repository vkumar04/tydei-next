"use client"

import { TrendingUp } from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { formatCurrency } from "@/lib/formatting"

interface AlertDetailTierProgressProps {
  metadata: Record<string, unknown>
}

function readNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const v = metadata[key]
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

/**
 * Render the tier's rebate value (audit M8). `tier_rebate` is
 * DISPLAY-scaled by the synthesizer: display-percent (3 = 3%) for
 * percent_of_spend, dollars for fixed/per-unit/per-procedure types.
 * Pre-M8 this always went through formatCurrency, so a 3% tier showed
 * as "$3.00". Older alerts lack `tier_rebate_type` — they were all
 * percent-denominated, so percent is the default.
 */
function formatTierRebate(value: number, rebateType: string | null): string {
  if (rebateType === null || rebateType === "percent_of_spend") {
    return `${value}%`
  }
  return formatCurrency(value)
}

export function AlertDetailTierProgress({
  metadata,
}: AlertDetailTierProgressProps) {
  const currentSpend = readNumber(metadata, "current_spend")
  const tierThreshold = readNumber(metadata, "tier_threshold")
  const amountNeeded = readNumber(metadata, "amount_needed")
  const targetTier = readNumber(metadata, "target_tier")
  const tierRebate = readNumber(metadata, "tier_rebate")
  const tierRebateType =
    typeof metadata["tier_rebate_type"] === "string"
      ? (metadata["tier_rebate_type"] as string)
      : null

  if (currentSpend === null || tierThreshold === null || tierThreshold <= 0) {
    return null
  }

  const percent = Math.min(100, Math.round((currentSpend / tierThreshold) * 100))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Tier Progress
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex justify-between text-sm">
          <span>Current Spend</span>
          <span className="font-medium">{formatCurrency(currentSpend)}</span>
        </div>
        <Progress value={percent} />
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">
            {targetTier !== null ? `Tier ${targetTier} threshold` : "Next tier"}
          </span>
          <span className="font-medium">{formatCurrency(tierThreshold)}</span>
        </div>
        {amountNeeded !== null ? (
          <p className="text-sm text-muted-foreground">
            Spend{" "}
            <span className="font-medium text-foreground">
              {formatCurrency(amountNeeded)}
            </span>{" "}
            more to reach
            {targetTier !== null ? ` Tier ${targetTier}` : " the next tier"}
            {tierRebate !== null ? (
              <>
                {" "}
                and earn a{" "}
                <span className="font-medium text-foreground">
                  {formatTierRebate(tierRebate, tierRebateType)}
                </span>{" "}
                rebate
              </>
            ) : null}
            .
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}
