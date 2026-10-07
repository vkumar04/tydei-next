"use client"

import { ErrorBoundaryCard } from "@/components/shared/error-boundary-card"

export default function VendorError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <ErrorBoundaryCard error={error} reset={retry} segment="vendor" />
}
