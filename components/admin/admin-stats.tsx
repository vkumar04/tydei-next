import {
  Building2,
  Truck,
  Users,
  FileText,
  DollarSign,
  CreditCard,
} from "lucide-react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { formatCurrency, formatCompactNumber } from "@/lib/formatting"

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
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      <MetricCard title="Facilities" value={stats.totalFacilities} icon={Building2} />
      <MetricCard title="Vendors" value={stats.totalVendors} icon={Truck} />
      <MetricCard title="Users" value={formatCompactNumber(stats.totalUsers)} icon={Users} />
      <MetricCard title="Active Contracts" value={formatCompactNumber(stats.totalContracts)} icon={FileText} />
      <MetricCard title="MRR" value={formatCurrency(stats.mrr)} icon={DollarSign} />
      <MetricCard title="Subscriptions" value={stats.activeSubscriptions} icon={CreditCard} />
    </div>
  )
}
