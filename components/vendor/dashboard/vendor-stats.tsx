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
import { formatCompactCurrency } from "@/lib/formatting"

interface VendorStatsProps {
  stats: {
    activeContracts: number
    totalContracts: number
    totalSpend: number
    totalRebates: number
    activeFacilities: number
    marketSharePercent: number
  }
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
        value={stats.activeContracts.toString()}
        icon={FileSignature}
        description={`of ${stats.totalContracts} total contracts`}
      />
      {/* 2026-06-09 audit: the underlying KPI sums ALL of the vendor's
          recorded COG (on prod, ~49% of it is not attached to any
          contract), so "Total Sales on Contract" overstated on-contract
          sales ~2×. Label it for what it measures. */}
      <MetricCard
        title="Total Sales"
        value={formatCompactCurrency(stats.totalSpend)}
        icon={DollarSign}
        description="all recorded purchases"
      />
      <MetricCard
        title="Market Share"
        value={`${stats.marketSharePercent.toFixed(1)}%`}
        icon={PieChart}
        description="of total facility spend (your share)"
      />
      <MetricCard
        title="Rebates Paid"
        value={formatCompactCurrency(stats.totalRebates)}
        icon={TrendingUp}
        description={`across ${stats.activeFacilities} facilities`}
      />
    </motion.div>
  )
}
