import { Suspense } from "react"
import type { NavItem } from "@/lib/types"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { can } from "@/lib/auth/permissions"
import { SidebarNav, SidebarNavList } from "@/components/shared/shells/sidebar-nav"

export function PortalNav({ items }: { items: NavItem[] }) {
  const ungated = items.filter((item) => !item.permission)
  return (
    <Suspense fallback={<SidebarNavList items={ungated} pathname={null} />}>
      <PermittedNav items={items} />
    </Suspense>
  )
}

async function PermittedNav({ items }: { items: NavItem[] }) {
  const ctx = await getCurrentAccessContext()
  const visible = items.filter(
    (item) => !item.permission || (ctx !== null && can(item.permission, ctx)),
  )
  return <SidebarNav items={visible} />
}
