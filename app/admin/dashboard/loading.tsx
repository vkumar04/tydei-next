import { Skeleton } from "@/components/ui/skeleton"

/**
 * Admin dashboard loading skeleton — mirrors the real layout in
 * `components/admin/admin-dashboard-client.tsx`: header row (title + 2 action
 * buttons), a 4-card KPI grid (md:grid-cols-2 lg:grid-cols-4), a Quick Actions /
 * Recent Activity 2-col grid, and the "Platform Performance" card with a 3-col
 * stat block. 2026-06-18: was a 6-col KPI grid + two 300px charts that didn't
 * match the screen.
 */
export default function AdminDashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-52" />
          <Skeleton className="h-4 w-80" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32 rounded-md" />
          <Skeleton className="h-9 w-32 rounded-md" />
        </div>
      </div>

      {/* KPI stats grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border bg-card p-6">
            <div className="flex items-center justify-between pb-2">
              <Skeleton className="h-4 w-28" />
              <Skeleton className="size-4 rounded" />
            </div>
            <Skeleton className="mt-2 h-7 w-20" />
            <Skeleton className="mt-1 h-3 w-32" />
          </div>
        ))}
      </div>

      {/* Quick Actions & Recent Activity */}
      <div className="grid gap-6 md:grid-cols-2">
        <div className="rounded-xl border bg-card p-6">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="mt-1 h-4 w-40" />
          <div className="mt-4 space-y-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-9 w-full rounded-md" />
            ))}
          </div>
        </div>
        <div className="rounded-xl border bg-card p-6">
          <Skeleton className="h-5 w-36" />
          <div className="mt-4 space-y-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-24" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Platform Performance */}
      <div className="rounded-xl border bg-card p-6">
        <Skeleton className="h-5 w-44" />
        <Skeleton className="mt-1 h-4 w-64" />
        <div className="mt-6 grid gap-6 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-7 w-24" />
              <Skeleton className="h-3 w-28" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
