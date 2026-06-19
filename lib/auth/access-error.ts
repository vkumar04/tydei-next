/**
 * Thrown by the access-tier gates (`requireCan` / `requireCanMutate` in
 * `lib/actions/auth-permissions.ts`) when a caller lacks a capability.
 * Lives in a NON-`"use server"` module because Next 16 forbids exporting
 * a class from a `"use server"` file.
 */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccessDeniedError"
  }
}
