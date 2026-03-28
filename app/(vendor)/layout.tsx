export default function VendorLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Will become <PortalShell role="vendor" /> in Phase 1
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 border-r bg-sidebar p-4 lg:block">
        <p className="text-sm font-medium text-sidebar-foreground">
          Vendor Portal
        </p>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
