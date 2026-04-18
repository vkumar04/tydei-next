"use client"

/**
 * Sidebar card showing COG spend-pattern analysis for the vendor tied to a
 * proposal (spec §subsystem-8).
 *
 * Surfaces:
 *   - Last-12-months spend total
 *   - Monthly stdev % + seasonality flag
 *   - Top-5 items by spend
 *   - Price drift vs pricing-file
 *   - Category market share + tie-in flag
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Activity,
  CalendarClock,
  Link2,
  TrendingUp,
} from "lucide-react"
import { useVendorCOGPatterns } from "./hooks"

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

function formatPercent(value: number, digits = 1): string {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`
}

export interface CogSpendPatternCardProps {
  vendorId: string | null
  vendorName?: string
}

export function CogSpendPatternCard({
  vendorId,
  vendorName,
}: CogSpendPatternCardProps) {
  const { data, isLoading, isError } = useVendorCOGPatterns(vendorId)

  if (!vendorId) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend patterns</CardTitle>
          <CardDescription>
            Select a vendor to pull 12-month COG patterns.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend patterns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (isError || !data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Spend patterns</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Unable to load COG patterns for this vendor.
          </p>
        </CardContent>
      </Card>
    )
  }

  const sharePct = data.categoryMarketShare * 100

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          Spend patterns
          {vendorName ? (
            <span className="text-sm font-normal text-muted-foreground">
              {" "}
              · {vendorName}
            </span>
          ) : null}
        </CardTitle>
        <CardDescription>
          Last 12 months from your COG data.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="text-xs text-muted-foreground">12-month spend</p>
          <p className="text-2xl font-bold">
            {formatCurrency(data.totalSpend12Mo)}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-md border p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <CalendarClock className="h-3 w-3" /> Monthly stdev
            </div>
            <div className="font-medium">
              {data.monthlyStdevPct.toFixed(1)}%
            </div>
            {data.seasonalityFlag ? (
              <Badge variant="outline" className="mt-1 text-[10px]">
                Seasonal
              </Badge>
            ) : null}
          </div>
          <div className="rounded-md border p-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> Drift vs pricing
            </div>
            <div className="font-medium">
              {formatPercent(data.priceDriftVsPricingFile)}
            </div>
            {data.priceDriftVsPricingFile > 5 ? (
              <Badge
                variant="outline"
                className="mt-1 text-[10px] border-amber-300 text-amber-700"
              >
                Review
              </Badge>
            ) : null}
          </div>
          <div className="rounded-md border p-2 col-span-2">
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Link2 className="h-3 w-3" /> Category market share
            </div>
            <div className="font-medium">{sharePct.toFixed(1)}%</div>
            {data.tieInRiskFlag ? (
              <Badge
                variant="outline"
                className="mt-1 text-[10px] border-red-300 text-red-700"
              >
                Tie-in risk
              </Badge>
            ) : null}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
            <Activity className="h-3 w-3" /> Top items by spend
          </div>
          {data.top5ItemsBySpend.length === 0 ? (
            <p className="text-xs text-muted-foreground">No purchase history.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.top5ItemsBySpend.map((it) => (
                <li
                  key={it.vendorItemNo}
                  className="flex items-center justify-between gap-2"
                >
                  <span className="truncate" title={it.description}>
                    {it.description || it.vendorItemNo}
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {formatCurrency(it.spend)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
