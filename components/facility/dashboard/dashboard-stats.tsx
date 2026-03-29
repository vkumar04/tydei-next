"use client"

import { MetricCard } from "@/components/shared/cards/metric-card"
import { DollarSign, TrendingUp, Bell, ShieldCheck } from "lucide-react"
import { formatCurrency, formatPercent } from "@/lib/formatting"

interface DashboardStatsProps {
  stats: {
    totalContractValue: number
    totalRebatesEarned: number
    activeAlertCount: number
    complianceRate: number
  }
}

export function DashboardStats({ stats }: DashboardStatsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <MetricCard
        title="Total Contract Value"
        value={formatCurrency(stats.totalContractValue)}
        icon={DollarSign}
      />
      <MetricCard
        title="Rebates Earned"
        value={formatCurrency(stats.totalRebatesEarned)}
        icon={TrendingUp}
      />
      <MetricCard
        title="Active Alerts"
        value={stats.activeAlertCount}
        icon={Bell}
      />
      <MetricCard
        title="Compliance Rate"
        value={formatPercent(stats.complianceRate, 0)}
        icon={ShieldCheck}
      />
    </div>
  )
}
