"use client"

import {
  FileSignature,
  DollarSign,
  PieChart,
  TrendingUp,
} from "lucide-react"
import { motion } from "motion/react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { staggerContainer } from "@/lib/animations"

interface VendorStatsProps {
  stats: {
    totalContracts: number
    totalSpend: number
    totalRebates: number
    activeFacilities: number
  }
}

function formatCurrencyShort(value: number): string {
  if (value >= 1000000) return `$${(value / 1000000).toFixed(1)}M`
  if (value >= 1000) return `$${(value / 1000).toFixed(0)}K`
  return `$${value.toFixed(0)}`
}

export function VendorStats({ stats }: VendorStatsProps) {
  return (
    <motion.div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <MetricCard
        title="Active Contracts"
        value={stats.totalContracts.toString()}
        icon={FileSignature}
        description="across all facilities"
      />
      <MetricCard
        title="Total Spend on Contract"
        value={formatCurrencyShort(stats.totalSpend)}
        icon={DollarSign}
        description="current period"
      />
      <MetricCard
        title="Market Share"
        value={
          stats.totalSpend > 0
            ? `${((stats.totalRebates / stats.totalSpend) * 100).toFixed(1)}%`
            : "0%"
        }
        icon={PieChart}
        description="across facilities"
      />
      <MetricCard
        title="Rebates Paid"
        value={formatCurrencyShort(stats.totalRebates)}
        icon={TrendingUp}
        description="total rebates"
      />
    </motion.div>
  )
}
