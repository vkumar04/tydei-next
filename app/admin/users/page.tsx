import { requireAdmin } from "@/lib/actions/auth"
import { PageHeader } from "@/components/shared/page-header"
import { UserTable } from "@/components/admin/user-table"

export default async function AdminUsersPage() {
  await requireAdmin()

  return (
    <div className="space-y-6">
      <PageHeader title="Users" description="Manage platform users" />
      <UserTable />
    </div>
  )
}
