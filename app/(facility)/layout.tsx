export default function FacilityLayout({
  children,
}: {
  children: React.ReactNode
}) {
  // Will become <PortalShell role="facility" /> in Phase 1
  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 border-r bg-sidebar p-4 lg:block">
        <p className="text-sm font-medium text-sidebar-foreground">
          Facility Portal
        </p>
      </aside>
      <main className="flex-1 p-6">{children}</main>
    </div>
  )
}
