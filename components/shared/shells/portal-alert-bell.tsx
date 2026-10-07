import { getPrincipal } from "@/lib/auth/principal"
import { getOpenAlertCount } from "@/lib/actions/alerts"
import { AlertBell } from "@/components/shared/shells/alert-bell"

export async function PortalAlertBell({ role }: { role: "facility" | "vendor" }) {
  const principal = await getPrincipal()
  const entityId = role === "facility" ? principal?.facility?.id : principal?.vendor?.id
  if (!entityId) return <AlertBell role={role} />
  const initialCount = await getOpenAlertCount({ portalType: role })
  return (
    <AlertBell
      role={role}
      facilityId={role === "facility" ? entityId : undefined}
      vendorId={role === "vendor" ? entityId : undefined}
      initialCount={initialCount}
    />
  )
}
