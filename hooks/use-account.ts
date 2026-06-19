"use client"

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { queryKeys } from "@/lib/query-keys"
import { authClient } from "@/lib/auth"
import { getMyAccount } from "@/lib/actions/account"

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
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) =>
      unwrap(await authClient.updateUser({ name })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.account.me() })
      toast.success("Name updated")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to update name"),
  })
}

// ─── Email ───────────────────────────────────────────────────────

export function useChangeAccountEmail() {
  return useMutation({
    mutationFn: async (newEmail: string) =>
      unwrap(
        await authClient.changeEmail({
          newEmail,
          callbackURL: "/dashboard",
        }),
      ),
    onSuccess: () => {
      // Email changes go through Resend verification — the new address is
      // not active until the user clicks the link in their inbox.
      toast.success("Verification email sent — check your inbox to confirm")
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Failed to change email"),
  })
}

// ─── Password ────────────────────────────────────────────────────

export function useChangeAccountPassword() {
  return useMutation({
    mutationFn: async (input: {
      currentPassword: string
      newPassword: string
    }) =>
      unwrap(
        await authClient.changePassword({
          currentPassword: input.currentPassword,
          newPassword: input.newPassword,
          revokeOtherSessions: true,
        }),
      ),
    onSuccess: () => {
      toast.success("Password changed")
    },
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Failed to change password",
      ),
  })
}
