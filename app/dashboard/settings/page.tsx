import { requireFacility } from "@/lib/actions/auth"
import { SettingsClient } from "@/components/facility/settings/settings-client"

export default async function SettingsPage() {
  const { facility } = await requireFacility()

  return (
    <SettingsClient
      facilityId={facility.id}
      organizationId={facility.organizationId ?? ""}
    />
  )
}
