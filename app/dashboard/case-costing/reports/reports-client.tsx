"use client"

import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { CostDistributionChart } from "@/components/facility/case-costing/cost-distribution-chart"
import { useCaseCostingReport, useCases } from "@/hooks/use-case-costing"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"
import { ChartCard } from "@/components/shared/charts/chart-card"
import { chartTooltipStyle } from "@/lib/chart-config"

interface CaseCostingReportsClientProps {
  facilityId: string
}

export function CaseCostingReportsClient({ facilityId }: CaseCostingReportsClientProps) {
  const { data: report, isLoading } = useCaseCostingReport(facilityId)
  const { data: casesData } = useCases(facilityId, { pageSize: 200 })

  if (isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid gap-4 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[100px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-[300px] rounded-xl" />
      </div>
    )
  }

  if (!report) return null

  return (
    <div className="space-y-6">
      <PageHeader
        title="Case Costing Reports"
        description="Summary metrics and trends for surgical case costs"
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="Total Cases" value={report.totalCases.toLocaleString()} />
        <StatCard label="Total Spend" value={`$${Math.round(report.totalSpend).toLocaleString()}`} />
        <StatCard label="Avg Cost/Case" value={`$${Math.round(report.avgCostPerCase).toLocaleString()}`} />
        <StatCard label="Total Reimbursement" value={`$${Math.round(report.totalReimbursement).toLocaleString()}`} />
        <StatCard label="Avg Margin" value={`$${Math.round(report.avgMargin).toLocaleString()}`} />
        <StatCard label="Compliance Rate" value={`${Math.round(report.complianceRate)}%`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {report.monthlyCosts.length > 0 && (
          <ChartCard title="Monthly Costs" description="Spend vs. reimbursement by month">
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={report.monthlyCosts}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} className="fill-muted-foreground" />
                <YAxis
                  tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                  className="fill-muted-foreground"
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  formatter={(v) => [`$${Number(v).toLocaleString()}`, ""]}
                  contentStyle={chartTooltipStyle}
                />
                <Bar dataKey="spend" name="Spend" fill="var(--primary)" radius={[4, 4, 0, 0]} />
                <Bar dataKey="reimbursement" name="Reimbursement" fill="var(--muted-foreground)" radius={[4, 4, 0, 0]} opacity={0.5} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        <CostDistributionChart cases={casesData?.cases ?? []} />
      </div>
    </div>
  )
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold">{value}</p>
      </CardContent>
    </Card>
  )
}
