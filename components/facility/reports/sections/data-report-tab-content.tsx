"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ReportPeriodTable } from "../report-period-table"
import { ReportTrendChart } from "../report-trend-chart"
import type { ContractPeriodRow } from "../report-columns"
import type { DateRange } from "./types"

/* ─── Props ──────────────────────────────────────────────────── */

export type DataReportType = "usage" | "service" | "capital" | "tie_in" | "grouped" | "pricing_only"

export interface DataReportTabContentProps {
  tab: DataReportType
  isLoading: boolean
  allPeriods: ContractPeriodRow[]
  metric: "totalSpend" | "rebateEarned" | "totalVolume"
  dateRange: DateRange
}

/* ─── Helpers ────────────────────────────────────────────────── */

const TAB_TITLES: Record<DataReportType, string> = {
  usage: "Contract Performance Details",
  service: "Service Contract Performance",
  capital: "Capital Contract Performance",
  tie_in: "Tie-In Contract Performance",
  grouped: "Grouped Contract Report",
  pricing_only: "Pricing Only Contract",
}

const TAB_BADGES: Record<DataReportType, string> = {
  usage: "Usage Contract",
  service: "Service Contract",
  capital: "Capital Contract",
  tie_in: "Tie-In Contract",
  grouped: "Grouped Contract",
  pricing_only: "Pricing Only",
}

/* ─── Component ──────────────────────────────────────────────── */

export function DataReportTabContent({
  tab,
  isLoading,
  allPeriods,
  metric,
  dateRange,
}: DataReportTabContentProps) {
  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-[300px] rounded-xl" />
        <Skeleton className="h-[400px] rounded-xl" />
      </div>
    )
  }

  return (
    <Card>
      <CardHeader className="bg-muted/50">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>{TAB_TITLES[tab]}</CardTitle>
            <CardDescription>
              From {dateRange.from} To {dateRange.to}
            </CardDescription>
          </div>
          <Badge
            variant={
              tab === "usage"
                ? "default"
                : tab === "service"
                ? "secondary"
                : "outline"
            }
          >
            {TAB_BADGES[tab]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pt-6">
        {/* Table */}
        <ReportPeriodTable periods={allPeriods} reportType={tab} />

        {/* Chart */}
        <div className="mt-6">
          <ReportTrendChart data={allPeriods} metric={metric} reportType={tab} />
        </div>
      </CardContent>
    </Card>
  )
}
