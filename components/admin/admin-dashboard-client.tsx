"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Building2,
  Truck,
  Users,
  DollarSign,
  Plus,
  ArrowRight,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
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
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h1 className="text-3xl font-bold tracking-tight text-balance">
            Admin Dashboard
          </h1>
          <p className="text-muted-foreground">
            Manage facilities, vendors, and users across the platform
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin/facilities?action=new">
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Facility
            </Button>
          </Link>
          <Link href="/admin/vendors?action=new">
            <Button variant="outline">
              <Plus className="h-4 w-4 mr-2" />
              Add Vendor
            </Button>
          </Link>
        </div>
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
        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Common admin tasks</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Link href="/admin/facilities?action=new">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Building2 className="h-4 w-4" />
                  Onboard New Facility
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/admin/vendors?action=new">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Onboard New Vendor
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/admin/users?action=new">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" />
                  Add User to Organization
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/admin/billing">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <DollarSign className="h-4 w-4" />
                  Manage Billing & Subscriptions
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        {activity.data ? (
          <ActivityFeed activities={activity.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {pending.data ? (
          <PendingActions actions={pending.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}

        {/* Platform Performance */}
        <Card>
          <CardHeader>
            <CardTitle>Platform Performance</CardTitle>
            <CardDescription>
              Contract processing and engagement metrics
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-6 sm:grid-cols-3">
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Contracts Processed
                </p>
                <p className="text-2xl font-bold">
                  {stats.data
                    ? stats.data.totalContracts.toLocaleString()
                    : "--"}
                </p>
                <p className="text-xs text-muted-foreground">Lifetime total</p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Active Subscriptions
                </p>
                <p className="text-2xl font-bold">
                  {stats.data
                    ? stats.data.activeSubscriptions.toLocaleString()
                    : "--"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Currently tracked
                </p>
              </div>
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">
                  Avg. Response Time
                </p>
                <p className="text-2xl font-bold">2.4 days</p>
                <p className="text-xs text-muted-foreground">
                  Contract review turnaround
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
