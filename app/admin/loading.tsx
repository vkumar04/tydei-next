import { Skeleton } from "@/components/ui/skeleton"
import { Card } from "@/components/ui/card"

/**
 * Segment-root loading skeleton for the admin portal. Renders inside the
 * admin `PortalShell` and is the fallback skeleton for every /admin/* route
 * (dashboard, facilities, vendors, users, billing, payor-contracts) that
 * doesn't define its own `loading.tsx`. Header + KPI row + a management
 * table — the shape the admin tenant-management pages render. Mirrors the
 * house style in `app/dashboard/loading.tsx`.
 */
export default function AdminLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-6">
            <div className="flex items-center justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="size-4 rounded" />
            </div>
            <Skeleton className="mt-3 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-28" />
          </Card>
        ))}
      </div>

      <Card className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-28 rounded-md" />
        </div>
        <div className="space-y-3">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-4 w-1/4" />
              <Skeleton className="h-4 w-1/5" />
              <Skeleton className="ml-auto h-8 w-20 rounded-md" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
