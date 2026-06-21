import { requireVendor } from "@/lib/actions/auth"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { vendorNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { AccessProvider } from "@/components/shared/auth/access-context"
import { getOpenAlertCount } from "@/lib/actions/alerts"

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await requireVendor()

  const alertCount = await getOpenAlertCount({
    vendorId: result.vendor.id,
    portalType: "vendor",
  })

  // See FacilityLayout — mounts the access tier so read-only vendor users
  // get the same client-side gating.
  const access = await getCurrentAccessContext()

  return (
    <AccessProvider tier={access?.tier ?? "super"} side="vendor">
      <PortalShell
        // oxlint-disable-next-line jsx-a11y/aria-role -- `role` is a typed PortalShell prop (PortalRole), not an HTML ARIA attribute; it never reaches the DOM.
        role="vendor"
        navItems={vendorNav}
        user={{
          name: result.user.name,
          email: result.user.email,
          image: result.user.image,
        }}
        alertCount={alertCount}
        vendorId={result.vendor.id}
      >
        {children}
      </PortalShell>
    </AccessProvider>
  )
}
