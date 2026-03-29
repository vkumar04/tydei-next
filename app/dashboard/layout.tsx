import { requireFacility } from "@/lib/actions/auth"
import { facilityNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { getUnreadAlertCount } from "@/lib/actions/alerts"

export default async function FacilityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await requireFacility()

  const alertCount = await getUnreadAlertCount({
    facilityId: result.facility.id,
    portalType: "facility",
  })

  return (
    <PortalShell
      role="facility"
      navItems={facilityNav}
      user={{
        name: result.user.name,
        email: result.user.email,
        image: result.user.image,
      }}
      alertCount={alertCount}
    >
      {children}
    </PortalShell>
  )
}
