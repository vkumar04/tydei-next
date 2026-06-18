/**
 * Next.js instrumentation — central server-error sink (2026-06-18 pre-prod
 * audit: there was no error monitoring; prod failures were Railway-stdout-only
 * with no aggregation or correlation).
 *
 * `onRequestError` fires for EVERY server-side error — Server Components, route
 * handlers, and Server Actions — so it's the one place to capture, correlate
 * (errorId), and forward errors. Today it routes through `reportServerError`
 * (one-line structured JSON with a correlation id + secret redaction). To add
 * Sentry/Datadog later, forward from here — no call-site changes needed.
 */
export async function onRequestError(
  error: unknown,
  request: {
    path: string
    method: string
    headers: Record<string, string | undefined>
  },
  context: {
    routerKind: string
    routePath: string
    routeType: string
  },
): Promise<void> {
  // Dynamic import so this stays out of the edge bundle and only loads in the
  // Node runtime where the error actually surfaces.
  const { reportServerError } = await import("@/lib/errors/report")
  reportServerError("onRequestError", error, {
    path: request.path,
    method: request.method,
    routerKind: context.routerKind,
    routePath: context.routePath,
    routeType: context.routeType,
  })
}
