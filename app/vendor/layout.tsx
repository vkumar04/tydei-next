import { requireRole } from "@/lib/actions/auth"
import { vendorNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireRole("vendor")

  return (
    <PortalShell
      role="vendor"
      navItems={vendorNav}
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
