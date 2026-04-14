"use client"

import { motion } from "motion/react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import {
  FileSignatureIcon,
  DollarSignIcon,
  TrendingUpIcon,
  AlertTriangleIcon,
} from "lucide-react"
import { staggerContainer } from "@/lib/animations"

interface DashboardStatsProps {
  stats: {
    activeContractCount: number
    recentContractsAdded: number
    totalSpend: number
    onContractSpend: number
    onContractPercent: number
    rebatesEarned: number
    rebatesCollected: number
    collectionRate: number
    pendingAlertCount: number
  }
}

function formatCurrencyShort(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function DashboardStats({ stats }: DashboardStatsProps) {
  return (
    <motion.div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <MetricCard
        title="Active Contracts"
        value={stats.activeContractCount.toString()}
        icon={FileSignatureIcon}
        change={
          stats.recentContractsAdded > 0
            ? `+${stats.recentContractsAdded}`
            : "0"
        }
        changeType="positive"
        description="from last month"
      />
      <MetricCard
        title="Total Spend"
        value={formatCurrencyShort(stats.totalSpend)}
        icon={DollarSignIcon}
        change={`${stats.onContractPercent.toFixed(1)}%`}
        changeType={stats.onContractPercent >= 50 ? "positive" : "negative"}
        secondaryValue={formatCurrencyShort(stats.onContractSpend)}
        secondaryLabel="On Contract"
        description="YTD spend"
      />
      <MetricCard
        title="Rebates"
        value={formatCurrencyShort(stats.rebatesEarned)}
        icon={TrendingUpIcon}
        change={`${stats.collectionRate.toFixed(1)}%`}
        changeType={stats.collectionRate >= 80 ? "positive" : "negative"}
        secondaryValue={formatCurrencyShort(stats.rebatesCollected)}
        secondaryLabel="Collected"
        description="earned from contracts"
      />
      <MetricCard
        title="Pending Alerts"
        value={stats.pendingAlertCount.toString()}
        icon={AlertTriangleIcon}
        change={stats.pendingAlertCount.toString()}
        changeType={stats.pendingAlertCount === 0 ? "positive" : "negative"}
        description="action needed"
      />
    </motion.div>
  )
}
