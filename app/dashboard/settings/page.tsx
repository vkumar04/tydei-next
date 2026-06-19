import { redirect } from "next/navigation"
import { requireFacility } from "@/lib/actions/auth"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { can } from "@/lib/auth/permissions"
import { SettingsClient } from "@/components/facility/settings/settings-client"

export default async function SettingsPage() {
  const { facility } = await requireFacility()

  // Settings/Users feature: only Super users may view Settings.
  // Defense-in-depth — the nav hides the entry, this blocks a hand-typed URL.
  const ctx = await getCurrentAccessContext()
  if (!ctx || !can("settings.view", ctx)) {
    redirect("/dashboard")
  }

  return (
    <SettingsClient
      facilityId={facility.id}
      organizationId={facility.organizationId ?? ""}
    />
  )
}
