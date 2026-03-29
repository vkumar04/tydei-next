import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { FacilityTable } from "@/components/admin/facility-table"

export default async function AdminFacilitiesPage() {
  await requireAdmin()

  return (
    <div className="space-y-6">
      <PageHeader title="Facilities" description="Manage platform facilities" />
      <FacilityTable />
    </div>
  )
}
