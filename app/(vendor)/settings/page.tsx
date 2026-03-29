import { requireVendor } from "@/lib/actions/auth"
import { VendorSettingsClient } from "@/components/vendor/settings/vendor-settings-client"

export default async function VendorSettingsPage() {
  const { vendor } = await requireVendor()

  return (
    <VendorSettingsClient
      vendorId={vendor.id}
      vendorName={vendor.name}
      organizationId={vendor.organizationId ?? ""}
    />
  )
}
