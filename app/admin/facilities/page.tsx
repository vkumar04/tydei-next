import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { FacilityTable } from "@/components/admin/facility-table"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default async function AdminFacilitiesPage() {
  await requireAdmin()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Link href="/admin">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <PageHeader
          title="Facilities"
          description="Manage healthcare facilities and their access"
        />
      </div>
      <FacilityTable />
    </div>
  )
}
