"use client"

import { FileText, Building2, Percent, DollarSign } from "lucide-react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { PerformanceRadar } from "./performance-radar"
import { formatCurrency, formatPercent } from "@/lib/formatting"
import type { VendorPerformanceData } from "@/lib/actions/vendor-analytics"

interface PerformanceDashboardProps {
  data: VendorPerformanceData
}

export function PerformanceDashboard({ data }: PerformanceDashboardProps) {
  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard title="Active Contracts" value={data.contractCount} icon={FileText} />
        <MetricCard title="Active Facilities" value={data.activeFacilities} icon={Building2} />
        <MetricCard title="Avg Rebate Rate" value={formatPercent(data.avgRebateRate)} icon={Percent} />
        <MetricCard title="Total Spend" value={formatCurrency(data.totalSpend)} icon={DollarSign} />
      </div>
      <PerformanceRadar
        scores={{
          compliance: data.compliance,
          delivery: data.delivery,
          quality: data.quality,
          pricing: data.pricing,
        }}
      />
    </div>
  )
}
