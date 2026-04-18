"use client"

/**
 * Facility dashboard — annual spend projection card.
 *
 * Consumes `SpendProjection` from
 * `lib/actions/dashboard/kpi.ts::getDashboardKPISummary.spendProjection`.
 * Shows projected annual spend, trailing 3-month avg, current-month-to-
 * date, and a trend arrow (UP / DOWN / FLAT).
 */

import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon, TrendingUpIcon } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"
import type { SpendProjection } from "@/lib/dashboard/spend-projection"

interface DashboardSpendProjectionProps {
  projection: SpendProjection
}

const TREND_META: Record<
  SpendProjection["trend"],
  { label: string; className: string; Icon: typeof ArrowUpIcon }
> = {
  UP: {
    label: "Trending up",
    className: "text-emerald-600 dark:text-emerald-400",
    Icon: ArrowUpIcon,
  },
  DOWN: {
    label: "Trending down",
    className: "text-rose-600 dark:text-rose-400",
    Icon: ArrowDownIcon,
  },
  FLAT: {
    label: "Stable",
    className: "text-muted-foreground",
    Icon: ArrowRightIcon,
  },
}

export function DashboardSpendProjection({
  projection,
}: DashboardSpendProjectionProps) {
  const trend = TREND_META[projection.trend]
  const TrendIcon = trend.Icon

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <TrendingUpIcon className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle>Projected Annual Spend</CardTitle>
            <CardDescription>
              Based on trailing 3-month run rate + month-to-date
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div>
          <p className="text-3xl font-bold tabular-nums leading-tight">
            {formatCurrency(projection.projectedAnnualSpend)}
          </p>
          <div
            className={`mt-1 flex items-center gap-1 text-sm font-medium ${trend.className}`}
          >
            <TrendIcon className="h-4 w-4" />
            <span>{trend.label}</span>
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 rounded-lg border bg-muted/30 p-3 text-xs">
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">3-mo avg</dt>
            <dd className="font-semibold tabular-nums">
              {formatCurrency(projection.trailing3MonthAvg)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-muted-foreground">Month-to-date</dt>
            <dd className="font-semibold tabular-nums">
              {formatCurrency(projection.currentMonthToDate)}
            </dd>
          </div>
          <div className="flex flex-col gap-0.5 col-span-2">
            <dt className="text-muted-foreground">Remaining months this year</dt>
            <dd className="font-semibold tabular-nums">
              {projection.remainingMonthsInYear}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
