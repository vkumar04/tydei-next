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
      role="vendor"
      navItems={vendorNav}
      user={{
        name: result.user.name,
        email: result.user.email,
        image: result.user.image,
      }}
      alertCount={alertCount}
    >
      {children}
    </PortalShell>
  )
}
