import { redirect } from "next/navigation"
import { requireVendor } from "@/lib/actions/auth"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { can } from "@/lib/auth/permissions"
import { VendorSettingsClient } from "@/components/vendor/settings/vendor-settings-client"

export default async function VendorSettingsPage() {
  const { vendor } = await requireVendor()

  // Settings/Users feature: only Super users may view Settings.
  const ctx = await getCurrentAccessContext()
  if (!ctx || !can("settings.view", ctx)) {
    redirect("/vendor/dashboard")
  }

  return (
    <VendorSettingsClient
      vendorId={vendor.id}
      vendorName={vendor.name}
      organizationId={vendor.organizationId ?? ""}
    />
  )
}
