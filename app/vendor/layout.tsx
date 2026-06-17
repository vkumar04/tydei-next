import { requireVendor } from "@/lib/actions/auth"
import { vendorNav } from "@/lib/constants"
import { PortalShell } from "@/components/shared/shells/portal-shell"
import { getUnreadAlertCount } from "@/lib/actions/alerts"

export default async function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await requireVendor()

  const alertCount = await getUnreadAlertCount({
    vendorId: result.vendor.id,
    portalType: "vendor",
  })

  return (
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
  )
}
