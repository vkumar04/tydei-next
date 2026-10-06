import { getPrincipal } from "@/lib/auth/principal"
import type { PortalRole } from "@/lib/types"
import { Skeleton } from "@/components/ui/skeleton"
import { UserMenu } from "@/components/shared/shells/user-menu"

export async function PortalUserMenu({ role }: { role: PortalRole }) {
  const principal = await getPrincipal()
  if (!principal) return null
  const { name, email, image } = principal.session.user
  return <UserMenu user={{ name, email, image }} role={role} />
}

export function UserMenuSkeleton() {
  return (
    <div className="flex items-center gap-3 px-2 py-1.5">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-1.5">
        <Skeleton className="h-3.5 w-24" />
        <Skeleton className="h-3 w-32" />
      </div>
    </div>
  )
}
