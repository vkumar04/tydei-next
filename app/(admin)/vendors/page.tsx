import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { VendorTable } from "@/components/admin/vendor-table"

export default async function AdminVendorsPage() {
  await requireAdmin()

  return (
    <div className="space-y-6">
      <PageHeader title="Vendors" description="Manage platform vendors" />
      <VendorTable />
    </div>
  )
}
