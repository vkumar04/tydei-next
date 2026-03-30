"use client"

import {
  Building2,
  Truck,
  Users,
  DollarSign,
} from "lucide-react"
import { motion } from "motion/react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { formatCurrency } from "@/lib/formatting"
import { staggerContainer } from "@/lib/animations"

interface AdminStatsProps {
  stats: {
    totalFacilities: number
    totalVendors: number
    totalUsers: number
    totalContracts: number
    mrr: number
    activeSubscriptions: number
  }
}

export function AdminStats({ stats }: AdminStatsProps) {
  return (
    <motion.div
      className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4"
      variants={staggerContainer}
      initial="hidden"
      animate="show"
    >
      <MetricCard
        title="Facilities"
        value={stats.totalFacilities.toString()}
        icon={Building2}
        description="registered facilities"
      />
      <MetricCard
        title="Vendors"
        value={stats.totalVendors.toString()}
        icon={Truck}
        description="vendor partners"
      />
      <MetricCard
        title="Users"
        value={stats.totalUsers.toString()}
        icon={Users}
        description="active users"
      />
      <MetricCard
        title="Monthly Revenue"
        value={formatCurrency(stats.mrr)}
        icon={DollarSign}
        change="+12.4%"
        changeType="positive"
        description={`${stats.activeSubscriptions} active subscriptions`}
      />
    </motion.div>
  )
}
