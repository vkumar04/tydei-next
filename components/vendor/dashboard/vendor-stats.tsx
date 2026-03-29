"use client"

import { FileText, DollarSign, TrendingUp, Building2 } from "lucide-react"
import { motion } from "motion/react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { formatCurrency } from "@/lib/formatting"
import { staggerContainer } from "@/lib/animations"

interface VendorStatsProps {
  stats: {
    totalContracts: number
    totalSpend: number
    totalRebates: number
    activeFacilities: number
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
      <MetricCard title="Total Contracts" value={stats.totalContracts} icon={FileText} />
      <MetricCard title="Total Spend" value={formatCurrency(stats.totalSpend)} icon={DollarSign} />
      <MetricCard title="Total Rebates" value={formatCurrency(stats.totalRebates)} icon={TrendingUp} />
      <MetricCard title="Active Facilities" value={stats.activeFacilities} icon={Building2} />
    </motion.div>
  )
}
