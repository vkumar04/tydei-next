import { LayoutDashboard } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"

export default function VendorDashboard() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Vendor Dashboard"
        description="Overview of your contracts and facility relationships"
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Vendor Dashboard"
        description="Vendor analytics and KPIs coming soon"
      />
    </div>
  )
}
