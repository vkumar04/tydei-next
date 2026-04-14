import { requireAdmin } from "@/lib/actions/auth"
import { FacilityTable } from "@/components/admin/facility-table"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default async function AdminFacilitiesPage() {
  await requireAdmin()

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Link href="/admin/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Facilities</h1>
            <p className="text-muted-foreground">
              Manage healthcare facilities and their access
            </p>
          </div>
        </div>
      </div>
      <FacilityTable />
    </div>
  )
}
