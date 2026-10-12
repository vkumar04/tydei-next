import { Suspense } from "react"
import { adminNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { PortalUserMenu, UserMenuSkeleton } from "@/components/shared/shells/portal-user-menu"
import { AdminGate } from "@/components/shared/auth/access-gate"
import Loading from "./loading"

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell
      // oxlint-disable-next-line jsx-a11y/aria-role -- `role` is a typed PortalShell prop (PortalRole), not an HTML ARIA attribute; it never reaches the DOM.
      role="admin"
      navItems={adminNav}
      userMenu={
        <Suspense fallback={<UserMenuSkeleton />}>
          <PortalUserMenu role="admin" />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <AdminGate>{children}</AdminGate>
      </Suspense>
    </PortalShell>
  )
}
