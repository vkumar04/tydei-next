import { VendorAlertsClient } from "@/components/vendor/alerts/vendor-alerts-client"
import { requireVendor } from "@/lib/actions/auth"

export default async function VendorAlertsPage() {
  await requireVendor()
  return <VendorAlertsClient />
}
