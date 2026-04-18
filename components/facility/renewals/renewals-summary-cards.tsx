"use client"

/**
 * Facility-wide summary cards for the renewals page.
 *
 * Consumes the pre-aggregated RenewalSummary shape produced by
 * `computeRenewalSummary` (lib/renewals/summary-stats.ts). Four uniform-
 * height cards with colored left-borders mirroring the status palette:
 *   red    → critical (≤30d)
 *   yellow → warning (≤90d, cumulative w/ critical)
 *   blue   → upcoming (at-risk dollar exposure)
 *   green  → healthy (strong performers)
 */

import type { LucideIcon } from "lucide-react"
import { AlertTriangle, Clock, DollarSign, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"
import type { RenewalSummary } from "@/lib/renewals/summary-stats"

interface RenewalsSummaryCardsProps {
  summary: RenewalSummary
}

type BorderAccent = "red" | "yellow" | "blue" | "green"

const accentBorderClass: Record<BorderAccent, string> = {
  red: "border-l-red-500",
  yellow: "border-l-yellow-500",
  blue: "border-l-blue-500",
  green: "border-l-green-500",
}

const accentIconClass: Record<BorderAccent, string> = {
  red: "text-red-500/60",
  yellow: "text-yellow-500/60",
  blue: "text-blue-500/60",
  green: "text-green-500/60",
}

interface StatCardProps {
  icon: LucideIcon
  title: string
  value: string
  description: string
  accent: BorderAccent
}

function StatCard({ icon: Icon, title, value, description, accent }: StatCardProps) {
  return (
    <Card className={`border-l-4 ${accentBorderClass[accent]} h-full`}>
      <CardContent className="flex h-full flex-col justify-between gap-2 p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{title}</p>
            <p className="mt-1 text-2xl font-bold tabular-nums">{value}</p>
          </div>
          <Icon className={`h-8 w-8 shrink-0 ${accentIconClass[accent]}`} />
        </div>
        <p className="text-xs text-muted-foreground">{description}</p>
      </CardContent>
    </Card>
  )
}

export function RenewalsSummaryCards({ summary }: RenewalsSummaryCardsProps) {
  const cumulative90 = summary.criticalCount + summary.warningCount

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={AlertTriangle}
        title="Expiring in 30 Days"
        value={summary.criticalCount.toString()}
        description="immediate attention"
        accent="red"
      />
      <StatCard
        icon={Clock}
        title="Expiring in 90 Days"
        value={cumulative90.toString()}
        description="action needed"
        accent="yellow"
      />
      <StatCard
        icon={DollarSign}
        title="At-Risk Spend"
        value={formatCurrency(summary.totalAtRiskSpend)}
        description="under-performing contracts"
        accent="blue"
      />
      <StatCard
        icon={CheckCircle2}
        title="Strong Performers"
        value={summary.strongPerformers.toString()}
        description="met or exceeded commitment"
        accent="green"
      />
    </div>
  )
}
