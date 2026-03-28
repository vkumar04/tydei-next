import { requireRole } from "@/lib/actions/auth"
import { adminNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const session = await requireRole("admin")

  return (
    <PortalShell
      role="admin"
      navItems={adminNav}
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
