import { requireFacility } from "@/lib/actions/auth"
import { SettingsClient } from "@/components/facility/settings/settings-client"

export default async function SettingsPage() {
  await requireFacility()

  return <SettingsClient />
}
