"use client"

import { useState, useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"
import { ReportPeriodTable } from "./report-period-table"
import { ReportTrendChart } from "./report-trend-chart"
import { ReportExportButton } from "./report-export-button"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getReportData } from "@/lib/actions/reports"
import type { ContractPeriodRow } from "./report-columns"

const REPORT_TYPES = [
  { label: "Usage", value: "usage" },
  { label: "Service", value: "service" },
  { label: "Tie-In", value: "tie_in" },
  { label: "Capital", value: "capital" },
  { label: "Grouped", value: "grouped" },
] as const

type ReportType = (typeof REPORT_TYPES)[number]["value"]

function getDefaultRange() {
  const now = new Date()
  const q = Math.floor(now.getMonth() / 3)
  const from = new Date(now.getFullYear(), q * 3, 1)
  const to = new Date(now.getFullYear(), q * 3 + 3, 0)
  return { from: from.toISOString().split("T")[0], to: to.toISOString().split("T")[0] }
}

interface ReportsClientProps {
  facilityId: string
}

export function ReportsClient({ facilityId }: ReportsClientProps) {
  const [reportType, setReportType] = useState<ReportType>("usage")
  const [dateRange, setDateRange] = useState(getDefaultRange)
  const [metric, setMetric] = useState<"totalSpend" | "rebateEarned" | "totalVolume">("totalSpend")

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.reports.data(facilityId, reportType, dateRange),
    queryFn: () => getReportData({ facilityId, reportType, dateFrom: dateRange.from, dateTo: dateRange.to }),
  })

  const allPeriods: ContractPeriodRow[] = useMemo(
    () => data?.contracts.flatMap((c) => c.periods) ?? [],
    [data]
  )

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Contract performance and period data"
        action={
          <ReportExportButton
            facilityId={facilityId}
            reportType={reportType}
            dateFrom={dateRange.from}
            dateTo={dateRange.to}
          />
        }
      />

      <div className="flex flex-wrap items-center gap-4">
        <Tabs value={reportType} onValueChange={(v) => setReportType(v as ReportType)}>
          <TabsList>
            {REPORT_TYPES.map((t) => (
              <TabsTrigger key={t.value} value={t.value}>{t.label}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <DateRangePicker dateRange={dateRange} onDateRangeChange={setDateRange} />
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-[250px] rounded-xl" />
          <Skeleton className="h-[400px] rounded-xl" />
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2">
            {(["totalSpend", "rebateEarned", "totalVolume"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMetric(m)}
                className={`rounded-md px-3 py-1 text-sm ${
                  metric === m ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                }`}
              >
                {m === "totalSpend" ? "Spend" : m === "rebateEarned" ? "Rebate" : "Volume"}
              </button>
            ))}
          </div>
          <ReportTrendChart data={allPeriods} metric={metric} />
          <ReportPeriodTable periods={allPeriods} reportType={reportType} />
        </>
      )}
    </div>
  )
}
