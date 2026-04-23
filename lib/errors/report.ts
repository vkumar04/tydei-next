/**
 * Structured server-error reporter.
 *
 * Every `"use server"` action that catches an error has been calling
 * `console.error('[action-name]', err, { ...context })` by hand.
 * That works locally, but in prod the user sees a redacted digest and
 * the server log is the only clue. This helper standardizes the
 * structure so:
 *   1. Every log entry is JSON-parseable — future log-ingest can
 *      route on `action`, `code`, or `facilityId` without regex.
 *   2. A stable `errorId` is generated per call so the UI can include
 *      it in toasts ("AI request error — ref abc123"). Charles's
 *      flakes #5 and #11 couldn't be traced because we had no
 *      end-to-end correlation ID.
 *   3. Sensitive fields in context are never stringified (see
 *      REDACT_KEYS).
 */

const REDACT_KEYS = new Set([
  "password",
  "token",
  "apiKey",
  "api_key",
  "secret",
  "authorization",
  "cookie",
])

function redactContext(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(ctx)) {
    if (REDACT_KEYS.has(k) || REDACT_KEYS.has(k.toLowerCase())) {
      out[k] = "[redacted]"
    } else {
      out[k] = v
    }
  }
  return out
}

function shortId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().slice(0, 8)
  }
  return Math.random().toString(36).slice(2, 10)
}

export interface ReportedError {
  errorId: string
  action: string
  message: string
}

/**
 * Log a server-side error with structured context and return a stable
 * errorId callers can include in the user-facing message.
 *
 * @example
 *   try { ... } catch (err) {
 *     const { errorId } = reportServerError("createBundle", err, {
 *       facilityId, primaryContractId,
 *     })
 *     throw new Error(`Failed to create bundle — ref ${errorId}`)
 *   }
 */
export function reportServerError(
  action: string,
  err: unknown,
  context: Record<string, unknown> = {},
): ReportedError {
  const errorId = shortId()
  const message =
    err instanceof Error ? err.message : String(err ?? "unknown error")
  const stack = err instanceof Error ? err.stack : undefined

  // JSON.stringify-safe payload. One line so log ingest can parse it.
  const payload = {
    ts: new Date().toISOString(),
    level: "error",
    action,
    errorId,
    message,
    context: redactContext(context),
    ...(stack ? { stack } : {}),
  }

  try {
    console.error(JSON.stringify(payload))
  } catch {
    // Fallback if context contains an unserializable value (e.g., BigInt).
    console.error(
      `[${action}] errorId=${errorId} ${message}`,
      redactContext(context),
    )
  }

  return { errorId, action, message }
}
