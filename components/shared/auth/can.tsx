"use client"

import type { ReactNode } from "react"
import type { Permission } from "@/lib/auth/permissions"
import { useCan, useCanMutate } from "@/components/shared/auth/access-context"

/**
 * `<Can permission="settings.manage">…</Can>` — render children only when
 * the current access tier permits `permission`. Optional `fallback` shows
 * when not permitted.
 */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission
  children: ReactNode
  fallback?: ReactNode
}) {
  return useCan(permission) ? <>{children}</> : <>{fallback}</>
}

/**
 * `<ReadOnlyGuard>…</ReadOnlyGuard>` — wraps a block of mutating controls.
 * For read-only (`user`) tier callers it renders the children inside a
 * disabled `<fieldset>` (which disables every nested form control / button)
 * and dims them, with a tooltip explaining why. Advanced/Super render
 * normally. The matching SERVER action still throws via `requireCanMutate`,
 * so this is the UX layer, not the security boundary.
 */
export function ReadOnlyGuard({
  children,
  title = "Your access is read-only",
}: {
  children: ReactNode
  title?: string
}) {
  const canMutate = useCanMutate()
  if (canMutate) return <>{children}</>
  return (
    <fieldset
      disabled
      title={title}
      className="m-0 min-w-0 border-0 p-0 opacity-60 [&_*]:cursor-not-allowed"
      aria-disabled="true"
    >
      {children}
    </fieldset>
  )
}
