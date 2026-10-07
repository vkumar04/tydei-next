import { Suspense } from "react"
import { facilityNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { PortalUserMenu, UserMenuSkeleton } from "@/components/shared/shells/portal-user-menu"
import { PortalAlertBell } from "@/components/shared/shells/portal-alert-bell"
import { AlertBellPlaceholder } from "@/components/shared/shells/alert-bell"
import { AccessGate } from "@/components/shared/auth/access-gate"
import Loading from "./loading"

export default function FacilityLayout({ children }: { children: React.ReactNode }) {
  return (
    <PortalShell
      // oxlint-disable-next-line jsx-a11y/aria-role -- `role` is a typed PortalShell prop (PortalRole), not an HTML ARIA attribute; it never reaches the DOM.
      role="facility"
      navItems={facilityNav}
      userMenu={
        <Suspense fallback={<UserMenuSkeleton />}>
          <PortalUserMenu role="facility" />
        </Suspense>
      }
      alertBell={
        <Suspense fallback={<AlertBellPlaceholder role="facility" />}>
          <PortalAlertBell role="facility" />
        </Suspense>
      }
    >
      <Suspense fallback={<Loading />}>
        <AccessGate side="facility">{children}</AccessGate>
      </Suspense>
    </PortalShell>
  )
}
