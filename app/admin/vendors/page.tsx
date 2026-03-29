import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorTable } from "@/components/admin/vendor-table"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { ArrowLeft } from "lucide-react"

export default async function AdminVendorsPage() {
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
          title="Vendors"
          description="Manage vendor organizations and their access"
        />
      </div>
      <VendorTable />
    </div>
  )
}
