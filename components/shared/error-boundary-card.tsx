"use client"

/**
 * Shared error-boundary UI for /dashboard, /vendor, /admin segments.
 *
 * Charles 2026-04-28 Bug #2 ("An error occurred in the Server
 * Components render. The specific message is omitted in production
 * builds…"). In prod, error.message is generic and useless; the
 * digest hash is the only handle into Vercel runtime logs. Surface
 * it prominently so users can copy + share, and console-log it on
 * mount so it lands in browser DevTools too.
 */

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"

export function ErrorBoundaryCard({
  error,
  reset,
  segment,
}: {
  error: Error & { digest?: string }
  reset: () => void
  /** Logged with the digest so multi-segment apps can be triaged. */
  segment: string
}) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    console.error(`[${segment} error boundary]`, {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    })
  }, [error, segment])

  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4">
      <h2 className="text-xl font-semibold">Something went wrong</h2>
      <p className="text-sm text-muted-foreground max-w-md text-center">
        {error.message || "An unexpected error occurred. Please try again."}
      </p>
      {error.digest && (
        <div className="flex flex-col items-center gap-2 max-w-md">
          <p className="text-xs text-muted-foreground">
            Error reference (share with support):
          </p>
          <div className="flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 text-xs font-mono">
              {error.digest}
            </code>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void navigator.clipboard
                  .writeText(error.digest ?? "")
                  .then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })
              }}
            >
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}
      <Button onClick={reset}>Try Again</Button>
    </div>
  )
}
