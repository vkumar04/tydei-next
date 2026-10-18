import { redirect } from "next/navigation"
import { getCurrentAccessContext } from "@/lib/actions/auth-permissions"
import { can } from "@/lib/auth/permissions"

export async function redirectUnlessCanMutate(to: string): Promise<void> {
  const ctx = await getCurrentAccessContext()
  if (!ctx || !can("mutate", ctx)) redirect(to)
}
