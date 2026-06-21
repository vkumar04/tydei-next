import { requireFacility } from "@/lib/actions/auth"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { facilityNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { AccessProvider } from "@/components/shared/auth/access-context"
import { getOpenAlertCount } from "@/lib/actions/alerts"

export default async function FacilityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await requireFacility()

  const alertCount = await getOpenAlertCount({
    facilityId: result.facility.id,
    portalType: "facility",
  })

  // Resolve the caller's access tier so client affordances (ReadOnlyGuard,
  // <Can>, useCanMutate) actually gate. Without this provider the context
  // defaults to `super` everywhere and a read-only `user` sees every
  // add/edit control (Charles: "User should just be read only").
  const access = await getCurrentAccessContext()

  return (
    <AccessProvider tier={access?.tier ?? "super"} side="facility">
      <PortalShell
        // oxlint-disable-next-line jsx-a11y/aria-role -- `role` is a typed PortalShell prop (PortalRole), not an HTML ARIA attribute; it never reaches the DOM.
        role="facility"
        navItems={facilityNav}
        user={{
          name: result.user.name,
          email: result.user.email,
          image: result.user.image,
        }}
        alertCount={alertCount}
        facilityId={result.facility.id}
      >
        {children}
      </PortalShell>
    </AccessProvider>
  )
}
