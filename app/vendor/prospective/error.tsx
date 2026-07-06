"use client"

/**
 * Route error boundary (Charles 2026-07-05 "when I click analyze deal
 * everything goes blank"): an unhandled client exception on this route used
 * to render a BLANK page. Whatever throws from here on, the user gets a
 * readable card, a retry, and the error is logged with its digest so the
 * server logs can be correlated.
 */

import { useEffect } from "react"
import { AlertTriangle, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

export default function ProspectiveError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("[vendor-prospective] route error:", error, {
      digest: error.digest,
    })
  }, [error])

  return (
    <div className="p-6">
      <Card className="border-destructive/40">
        <CardContent className="flex flex-col items-start gap-3 pt-6">
          <div className="flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-5 w-5 text-destructive" />
            Something broke on this page
          </div>
          <p className="text-sm text-muted-foreground">
            The Prospective workspace hit an unexpected error
            {error.digest ? ` (ref ${error.digest})` : ""}. Your saved
            proposals and analyses are safe — this only affected the current
            view.
          </p>
          <Button size="sm" onClick={reset}>
            <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
            Try again
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
