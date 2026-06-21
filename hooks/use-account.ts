"use client"

import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { authClient } from "@/lib/auth"
import { getMyAccount } from "@/lib/actions/account"
import { useToastMutation } from "@/hooks/use-toast-mutation"

// ─── Read ────────────────────────────────────────────────────────

export function useMyAccount() {
  return useQuery({
    queryKey: queryKeys.account.me(),
    queryFn: () => getMyAccount(),
  })
}

// better-auth client methods resolve to `{ data, error }` rather than
// rejecting, so we unwrap the `error` into a throw — that routes through
// the mutation `onError` path (sonner toast) consistently with the rest
// of the hooks in this repo.
function unwrap<T>(result: { data: T | null; error: { message?: string } | null }): T {
  if (result.error) {
    throw new Error(result.error.message || "Request failed")
  }
  return result.data as T
}

// ─── Name ────────────────────────────────────────────────────────

export function useUpdateAccountName() {
  return useToastMutation(
    async (name: string) => unwrap(await authClient.updateUser({ name })),
    {
      invalidate: [queryKeys.account.me()],
      success: "Name updated",
      error: "Failed to update name",
    },
  )
}

// ─── Email ───────────────────────────────────────────────────────

export function useChangeAccountEmail() {
  return useToastMutation(
    async (newEmail: string) =>
      unwrap(
        await authClient.changeEmail({ newEmail, callbackURL: "/dashboard" }),
      ),
    {
      // Email changes go through Resend verification — the new address is not
      // active until the user clicks the link in their inbox.
      success: "Verification email sent — check your inbox to confirm",
      error: "Failed to change email",
    },
  )
}

// ─── Password ────────────────────────────────────────────────────

export function useChangeAccountPassword() {
  return useToastMutation(
    async (input: { currentPassword: string; newPassword: string }) =>
      unwrap(
        await authClient.changePassword({
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        }),
      ),
    { success: "Password changed", error: "Failed to change password" },
  )
}
