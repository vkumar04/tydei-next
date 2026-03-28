import { requireRole } from "@/lib/actions/auth"
import { facilityNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"

export default async function FacilityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireRole("facility")

  return (
    <PortalShell
      role="facility"
      navItems={facilityNav}
      user={{
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      }}
    >
      {children}
    </PortalShell>
  )
}
