"use client"

/**
 * Root global error boundary (2026-06-18 pre-prod audit). Catches errors that
 * escape the per-segment `error.tsx` boundaries — including failures in the
 * root layout. It must render its own <html>/<body>. The error's `digest`
 * correlates with the structured server log emitted by instrumentation.ts's
 * onRequestError, so support can map a user report to a log line.
 */
import { useEffect } from "react"

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Surface client-visible context; the server already logged via
    // instrumentation.onRequestError with the matching digest.
    console.error("[global-error]", error.digest ?? "", error.message)
  }, [error])

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#0a0a0f",
          color: "#e5e7eb",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, marginBottom: 8 }}>
            Something went wrong
          </h1>
          <p style={{ fontSize: 14, color: "#9ca3af", marginBottom: 20 }}>
            An unexpected error occurred. Our team has been notified.
            {error.digest ? (
              <>
                {" "}
                Reference: <code>{error.digest}</code>
              </>
            ) : null}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid #374151",
              background: "#1f2937",
              color: "#e5e7eb",
              cursor: "pointer",
              fontSize: 14,
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}
