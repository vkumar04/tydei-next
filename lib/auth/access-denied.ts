/**
 * Denial error for Server Actions.
 *
 * Lives here, NOT in `lib/actions/auth.ts`, because that file is `"use server"`
 * and every export from one must be an async function — Turbopack's prod
 * transform emits `registerServerReference(X, …)` for anything else, which
 * throws at module evaluation and takes down every action in the file. The
 * repo's `use-server-async-export-scanner` test catches it; it caught this one.
 */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "AccessDeniedError"
  }
}

/** Narrow an unknown caught value to a guard denial. */
export function isAccessDenied(err: unknown): err is AccessDeniedError {
  return err instanceof Error && err.name === "AccessDeniedError"
}
