import { LayoutDashboard } from "lucide-react"
import { PageHeader } from "@/components/shared/page-header"
import { EmptyState } from "@/components/shared/empty-state"

export default function AdminDashboard() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Admin Dashboard"
        description="Platform overview and management"
      />
      <EmptyState
        icon={LayoutDashboard}
        title="Admin Dashboard"
        description="Platform metrics and management tools coming soon"
      />
    </div>
  )
}
