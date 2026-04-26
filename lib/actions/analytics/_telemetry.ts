"use server"

/**
 * Lightweight wall-clock telemetry for the analytics action layer.
 *
 * Today's analytics actions are facility/vendor-scoped reads of varying
 * cost (single contract → cheap; per-facility leakage CTE → can be
 * pricey). When a page is slow, we want to know which action was the
 * culprit without reaching for an APM. Logs land in the Railway
 * server logs (or stdout in dev) where existing console.error from
 * the AI-action error path already lives.
 *
 * Schema (one structured line per call):
 *   [analytics] <action> ok=<bool> ms=<int> [scope=<facility|vendor>] [...extra]
 *
 * Failures still re-throw — the calling action's outer try/catch
 * decides what message reaches the client.
 *
 * Usage:
 *   export async function getX(id: string) {
 *     return withTelemetry("getX", { contractId: id }, async () => {
 *       // implementation
 *     })
 *   }
 */

export async function withTelemetry<T>(
  actionName: string,
  ctx: Record<string, unknown>,
  fn: () => Promise<T>,
): Promise<T> {
  const started = performance.now()
  let ok = false
  try {
    const result = await fn()
    ok = true
    return result
  } finally {
    const ms = Math.round(performance.now() - started)
    const ctxParts = Object.entries(ctx)
      .filter(([, v]) => v !== undefined && v !== null)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ")
    // One structured line. Don't break on logging itself.
    try {
      console.log(
        `[analytics] ${actionName} ok=${ok} ms=${ms}${ctxParts ? " " + ctxParts : ""}`,
      )
    } catch {
      // ignore
    }
  }
}
