import { Suspense } from "react"
import { requireFacility } from "@/lib/actions/auth"
import { ReportsClient } from "@/components/facility/reports/reports-client"
import { Skeleton } from "@/components/ui/skeleton"

/**
 * Reports Hub — server component shell.
 *
 * Scopes to the active facility, then hands off to the client
 * orchestrator. The hub itself is streamed with a Suspense fallback
 * so initial paint is responsive while the per-tab server actions
 * resolve on the client via TanStack Query.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.1
 */
export default async function ReportsPage() {
  const { facility } = await requireFacility()

  return (
    <Suspense fallback={<ReportsHubSkeleton />}>
      <ReportsClient facilityId={facility.id} />
    </Suspense>
  )
}

function ReportsHubSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-10 w-48" />
      <div className="grid gap-4 md:grid-cols-3">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </div>
      <Skeleton className="h-24 rounded-xl" />
      <Skeleton className="h-[500px] rounded-xl" />
    </div>
  )
}
