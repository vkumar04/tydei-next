"use client"

import { ErrorBoundaryCard } from "@/components/shared/error-boundary-card"

export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string }
  retry: () => void
}) {
  return <ErrorBoundaryCard error={error} reset={retry} segment="dashboard" />
}
