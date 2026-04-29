"use client"

import { ErrorBoundaryCard } from "@/components/shared/error-boundary-card"

export default function VendorError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return <ErrorBoundaryCard error={error} reset={reset} segment="vendor" />
}
