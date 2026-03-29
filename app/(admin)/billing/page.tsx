import { requireAdmin } from "@/lib/actions/auth"
import { BillingClient } from "@/components/admin/billing-client"

export default async function AdminBillingPage() {
  await requireAdmin()

  return <BillingClient />
}
