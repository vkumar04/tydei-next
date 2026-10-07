import { VendorAlertsClient } from "@/components/vendor/alerts/vendor-alerts-client"
import { requireVendor } from "@/lib/actions/auth"

export const instant = false

export default async function VendorAlertsPage() {
  await requireVendor()
  return <VendorAlertsClient />
}
