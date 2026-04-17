"use client"

import { useMemo } from "react"
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { FileText, DollarSign, Percent, Trophy } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import { chartTooltipStyle } from "@/lib/chart-config"
import { scoreColor, STATUS_CONFIG } from "./shared"
import type { VendorProposal } from "@/lib/actions/prospective"

const STATUS_BAR_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  submitted: "#3b82f6",
  accepted: "#22c55e",
  rejected: "#ef4444",
  under_review: "#f59e0b",
}

interface Props {
  proposals: VendorProposal[]
  isLoading: boolean
}

export function AnalyticsSection({ proposals, isLoading }: Props) {
  const metrics = useMemo(() => {
    if (!proposals) return { total: 0, avgScore: 0, pipeline: 0, winRate: 0 }

    const scored = proposals.filter((p) => p.dealScore)
    const avgScore =
      scored.length > 0
        ? Math.round(scored.reduce((s, p) => s + (p.dealScore?.overall ?? 0), 0) / scored.length)
        : 0

    const pipeline = proposals.reduce((s, p) => s + p.totalProposedCost, 0)
    const accepted = proposals.filter((p) => p.status === "accepted").length
    const decidedCount = proposals.filter(
      (p) => p.status === "accepted" || p.status === "rejected",
    ).length
    const winRate = decidedCount > 0 ? Math.round((accepted / decidedCount) * 100) : 0

    return { total: proposals.length, avgScore, pipeline, winRate }
  }, [proposals])

  const statusChart = useMemo(() => {
    if (!proposals) return []
    const counts: Record<string, number> = {}
    for (const p of proposals) {
      counts[p.status] = (counts[p.status] ?? 0) + 1
    }
    return Object.entries(counts).map(([status, count]) => ({
      status: STATUS_CONFIG[status]?.label ?? status,
      count,
      fill: STATUS_BAR_COLORS[status] ?? "#6b7280",
    }))
  }, [proposals])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: FileText, label: "Total Proposals", value: String(metrics.total), color: "text-primary", bg: "bg-primary/10" },
          { icon: Trophy, label: "Avg Score", value: metrics.avgScore > 0 ? String(metrics.avgScore) : "--", color: metrics.avgScore > 0 ? scoreColor(metrics.avgScore) : "", bg: "bg-blue-100 dark:bg-blue-900/30" },
          { icon: DollarSign, label: "Revenue Pipeline", value: formatCurrency(metrics.pipeline), color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
          { icon: Percent, label: "Win Rate", value: metrics.winRate > 0 ? `${metrics.winRate}%` : "--", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${m.bg}`}>
                  <m.icon className={`h-5 w-5 ${m.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{m.label}</p>
                  <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposals by Status</CardTitle>
          <CardDescription>Distribution of proposals across workflow stages</CardDescription>
        </CardHeader>
        <CardContent>
          {statusChart.length > 0 ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="status"
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "var(--muted-foreground)", fontSize: 12 }}
                    axisLine={{ stroke: "var(--border)" }}
                    tickLine={{ stroke: "var(--border)" }}
                  />
                  <RechartsTooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Proposals">
                    {statusChart.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
              No proposal data yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
