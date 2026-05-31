/**
 * Error-as-value helper for Server Actions.
 *
 * Vick 2026-05-30/31: Next.js 16 production builds redact EVERY error
 * thrown from a Server Action — the client only sees "An error occurred
 * in the Server Components render. The specific message is omitted in
 * production builds..." with a `digest` hash. Even a thoughtfully
 * humanized `throw new Error(...)` is discarded before it reaches the
 * client (see df12793, which introduced this pattern for createContract
 * via `createContractSafe`).
 *
 * A serializable RETURN value crosses the action boundary intact, so
 * wrapping a throwing action in `toSafeResult` lets the real failure
 * reason reach the toast. This module is intentionally NOT a
 * `"use server"` file — it's a plain helper imported INTO action
 * modules, where the try/catch runs server-side and catches the error
 * before the framework redacts it.
 */
import { ZodError } from "zod"

export type SafeResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string }

/** Turn an unknown thrown value into a human-readable, non-redacted string. */
export function humanizeActionError(err: unknown): string {
  if (err instanceof ZodError) {
    const first = err.issues[0]
    return first
      ? `${first.path.join(".") || "input"}: ${first.message}`
      : "Validation failed"
  }
  if (err instanceof Error && err.message) return err.message
  const s = String(err ?? "")
  return s || "Unknown error"
}

/**
 * Run a server-side operation and return its result as a discriminated
 * union instead of throwing. On failure, logs `[label]` with context
 * (the only debugging path in production) and returns the real,
 * un-redacted message.
 */
export async function toSafeResult<T>(
  label: string,
  ctx: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<SafeResult<T>> {
  try {
    return { ok: true, data: await fn() }
  } catch (err) {
    console.error(`[${label}]`, err, ctx)
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "") || undefined
        : undefined
    return { ok: false, error: humanizeActionError(err), code }
  }
}
