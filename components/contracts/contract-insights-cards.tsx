"use client"

import { useQuery } from "@tanstack/react-query"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { formatCurrency } from "@/lib/formatting"
import { getContractInsights } from "@/lib/actions/contracts/insights"

interface ContractInsightsCardsProps {
  contractId: string
}

export function ContractInsightsCards({ contractId }: ContractInsightsCardsProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["contract-insights", contractId],
    queryFn: () => getContractInsights(contractId),
  })

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
        <Skeleton className="h-40" />
      </div>
    )
  }

  const { compliance, priceVariance, marketShare } = data

  return (
    <div className="grid gap-4 md:grid-cols-3">
      {/* Compliance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Compliance Rate</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {compliance.compliancePercent === null ? (
            <p className="text-sm text-muted-foreground">No purchases to evaluate</p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {compliance.compliancePercent.toFixed(0)}%
                </span>
                <span className="text-xs text-muted-foreground">
                  {compliance.compliantPurchases} of {compliance.totalPurchases}
                </span>
              </div>
              <Progress value={compliance.compliancePercent} className="h-1.5" />
              <div className="grid grid-cols-2 gap-1 text-xs text-muted-foreground pt-1">
                <div>
                  Off-contract:{" "}
                  <span className="font-medium text-foreground">
                    {compliance.violationCounts.off_contract}
                  </span>
                </div>
                <div>
                  Expired:{" "}
                  <span className="font-medium text-foreground">
                    {compliance.violationCounts.expired_contract}
                  </span>
                </div>
                <div>
                  Unapproved:{" "}
                  <span className="font-medium text-foreground">
                    {compliance.violationCounts.unapproved_item}
                  </span>
                </div>
                <div>
                  Price variance:{" "}
                  <span className="font-medium text-foreground">
                    {compliance.violationCounts.price_variance}
                  </span>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Market Share */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Market Share</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!marketShare ? (
            <p className="text-sm text-muted-foreground">
              Not applicable — contract has no product category scope.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {marketShare.currentMarketShare.toFixed(1)}%
                </span>
                {marketShare.commitmentMet !== null && (
                  <Badge
                    variant={marketShare.commitmentMet ? "default" : "secondary"}
                  >
                    {marketShare.commitmentMet ? "Meeting" : "Short of"} commitment
                  </Badge>
                )}
              </div>
              <Progress
                value={Math.min(100, marketShare.currentMarketShare)}
                className="h-1.5"
              />
              {marketShare.gap !== null && (
                <p className="text-xs text-muted-foreground">
                  {marketShare.gap >= 0
                    ? `Exceeding commitment by ${marketShare.gap.toFixed(1)}pp`
                    : `${Math.abs(marketShare.gap).toFixed(1)}pp short of commitment`}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Price Variance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Price Variance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {priceVariance.totalLines === 0 ? (
            <p className="text-sm text-muted-foreground">
              No matching invoice lines to compare.
            </p>
          ) : (
            <>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-semibold">
                  {formatCurrency(priceVariance.overchargeTotal)}
                </span>
                <span className="text-xs text-muted-foreground">overcharge total</span>
              </div>
              <div className="grid grid-cols-3 gap-1 text-xs">
                <Badge variant="outline" className="justify-center">
                  {priceVariance.bySeverity.critical} critical
                </Badge>
                <Badge variant="outline" className="justify-center">
                  {priceVariance.bySeverity.warning} warning
                </Badge>
                <Badge variant="outline" className="justify-center">
                  {priceVariance.bySeverity.acceptable} acceptable
                </Badge>
              </div>
              {priceVariance.underchargeTotal !== 0 && (
                <p className="text-xs text-muted-foreground">
                  Undercharge offset:{" "}
                  <span className="font-medium text-foreground">
                    {formatCurrency(Math.abs(priceVariance.underchargeTotal))}
                  </span>
                </p>
              )}
              <p className="text-xs text-muted-foreground pt-1">
                Based on {priceVariance.totalLines} invoice{" "}
                {priceVariance.totalLines === 1 ? "line" : "lines"}
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
