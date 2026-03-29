"use client"

import { useQuery } from "@tanstack/react-query"
import { Skeleton } from "@/components/ui/skeleton"
import { PageHeader } from "@/components/shared/page-header"
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
    <div className="space-y-6">
      <PageHeader title="Admin Dashboard" description="Platform overview and management" />

      {stats.data ? (
        <AdminStats stats={stats.data} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
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
