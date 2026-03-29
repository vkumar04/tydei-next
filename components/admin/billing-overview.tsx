import { DollarSign, CreditCard } from "lucide-react"
import { MetricCard } from "@/components/shared/cards/metric-card"
import { formatCurrency } from "@/lib/formatting"

interface BillingOverviewProps {
  mrr: number
  subscriptions: number
}

export function BillingOverview({ mrr, subscriptions }: BillingOverviewProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <MetricCard title="Monthly Recurring Revenue" value={formatCurrency(mrr)} icon={DollarSign} />
      <MetricCard title="Active Subscriptions" value={subscriptions} icon={CreditCard} />
    </div>
  )
}
