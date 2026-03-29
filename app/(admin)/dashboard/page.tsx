import { requireAdmin } from "@/lib/actions/auth"
import { AdminDashboardClient } from "@/components/admin/admin-dashboard-client"

export default async function AdminDashboard() {
  await requireAdmin()

  return <AdminDashboardClient />
}
