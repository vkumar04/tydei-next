import type { ReactNode } from "react"
import { requireFacility, requireRole, requireVendor } from "@/lib/actions/auth"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { AccessProvider } from "@/components/shared/auth/access-context"
import type { AccessSide } from "@/lib/auth/permissions"

export async function AccessGate({
  side,
  children,
}: {
  side: AccessSide
  children: ReactNode
}) {
  if (side === "facility") await requireFacility()
  else await requireVendor()
  const access = await getCurrentAccessContext()
  return (
    <AccessProvider tier={access?.tier ?? "user"} side={side}>
      {children}
    </AccessProvider>
  )
}

export async function AdminGate({ children }: { children: ReactNode }) {
  await requireRole("admin")
  return children
}
