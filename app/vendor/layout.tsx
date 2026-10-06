import { Suspense } from "react"
import { vendorNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { PortalUserMenu, UserMenuSkeleton } from "@/components/shared/shells/portal-user-menu"
import { PortalAlertBell } from "@/components/shared/shells/portal-alert-bell"
import { AlertBell } from "@/components/shared/shells/alert-bell"
import { AccessGate } from "@/components/shared/auth/access-gate"
import Loading from "./loading"

export default function VendorLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell
      // oxlint-disable-next-line jsx-a11y/aria-role -- `role` is a typed PortalShell prop (PortalRole), not an HTML ARIA attribute; it never reaches the DOM.
      role="vendor"
      navItems={vendorNav}
      userMenu={
        <Suspense fallback={<UserMenuSkeleton />}>
          <PortalUserMenu role="vendor" />
        </Suspense>
      }
      alertBell={
        <Suspense fallback={<AlertBell role="vendor" />}>
          <PortalAlertBell role="vendor" />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <AccessGate side="vendor">{children}</AccessGate>
      </Suspense>
    </PortalShell>
  )
}
