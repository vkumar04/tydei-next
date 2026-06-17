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
      // oxlint-disable-next-line jsx-a11y/aria-role -- `role` is a typed PortalShell prop (PortalRole), not an HTML ARIA attribute; it never reaches the DOM.
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
