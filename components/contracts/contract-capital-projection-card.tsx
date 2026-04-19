"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getContractCapitalProjection } from "@/lib/actions/contracts/tie-in"

interface ContractCapitalProjectionCardProps {
  contractId: string
}

/**
 * Wave C — Run-rate projection card.
 *
 * Renders only when the contract is tie_in AND has a tie-in term with
 * capitalCost > 0. Three rows:
 *   1. Trailing-90-day rebate velocity (monthlyPaydownRun)
 *   2. Projected months to payoff
 *   3. Projected end-of-term balance
 *
 * See `getContractCapitalProjection` for the math.
 */
export function ContractCapitalProjectionCard({
  contractId,
}: ContractCapitalProjectionCardProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-capital-projection", contractId],
    queryFn: () => getContractCapitalProjection(contractId),
  })

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Capital Payoff Projection</CardTitle>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-32 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (!data?.hasProjection) return null

  const {
    monthlyPaydownRun,
    projectedMonthsToPayoff,
    projectedEndOfTermBalance,
    paidOffBeforeTermEnd,
  } = data

  const zeroVelocity = monthlyPaydownRun <= 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capital Payoff Projection</CardTitle>
        <p className="text-xs text-muted-foreground pt-1">
          Run-rate from trailing-90-day rebate velocity.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div>
            <div className="text-xs text-muted-foreground">
              Trailing-90-day rebate velocity
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {formatCurrency(monthlyPaydownRun)}
              <span className="text-xs font-normal text-muted-foreground">
                {" "}/ month
              </span>
            </div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Projected months to payoff
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {projectedMonthsToPayoff != null
                ? `${projectedMonthsToPayoff} mo`
                : "—"}
            </div>
            {zeroVelocity && (
              <p className="text-xs text-muted-foreground">
                No rebate activity in the last 90 days.
              </p>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">
              Projected end-of-term balance
            </div>
            <div className="text-lg font-semibold tabular-nums">
              {formatCurrency(projectedEndOfTermBalance)}
            </div>
            {paidOffBeforeTermEnd && (
              <p className="text-xs text-emerald-600 dark:text-emerald-400">
                Paid off before term end
              </p>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
