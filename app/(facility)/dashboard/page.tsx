import { LayoutDashboard } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"

export default function FacilityDashboard() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Overview of your contracts, spend, and performance"
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Dashboard"
        description="Contract analytics and KPIs coming soon"
      />
    </div>
  )
}
