"use client"

import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { AdminStats } from "./admin-stats"
import { ActivityFeed } from "./activity-feed"
import { PendingActions } from "./pending-actions"
import {
  getAdminDashboardStats,
  getAdminRecentActivity,
  getAdminPendingActions,
} from "@/lib/actions/admin/dashboard"
import { queryKeys } from "@/lib/query-keys"

export function AdminDashboardClient() {
  const stats = useQuery({
    queryKey: queryKeys.admin.stats(),
    queryFn: getAdminDashboardStats,
  })
  const activity = useQuery({
    queryKey: queryKeys.admin.activity(),
    queryFn: () => getAdminRecentActivity(10),
  })
  const pending = useQuery({
    queryKey: queryKeys.admin.pendingActions(),
    queryFn: getAdminPendingActions,
  })

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-balance">
          Admin Dashboard
        </h1>
        <p className="text-muted-foreground">
          Platform overview and management
        </p>
      </div>

      {stats.data ? (
        <AdminStats stats={stats.data} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[140px] rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {activity.data ? (
          <ActivityFeed activities={activity.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
        {pending.data ? (
          <PendingActions actions={pending.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
      </div>
    </div>
  )
}
