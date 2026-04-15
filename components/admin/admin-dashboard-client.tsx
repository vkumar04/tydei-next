"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import {
  Building2,
  Truck,
  Users,
  DollarSign,
  TrendingUp,
  Plus,
  ArrowRight,
  AlertCircle,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ActivityFeed } from "./activity-feed"
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

  const pendingItems = pending.data
    ? [
        ...(pending.data.newFacilitySetups > 0
          ? [
              {
                message: "New facilities pending setup",
                count: pending.data.newFacilitySetups,
              },
            ]
          : []),
        ...(pending.data.trialExpirations > 0
          ? [
              {
                message: "Trials expiring in 30 days",
                count: pending.data.trialExpirations,
              },
            ]
          : []),
        ...(pending.data.failedPayments > 0
          ? [
              {
                message: "Payment failed - requires attention",
                count: pending.data.failedPayments,
              },
            ]
          : []),
      ]
    : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Admin Dashboard</h1>
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

      {/* Pending Actions Alert */}
      {pendingItems.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2 text-amber-700 dark:text-amber-400">
              <AlertCircle className="h-5 w-5" />
              Pending Actions
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-4">
              {pendingItems.map((action, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Badge
                    variant="secondary"
                    className="bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
                  >
                    {action.count}
                  </Badge>
                  <span className="text-sm">{action.message}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      {stats.data ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Facilities
              </CardTitle>
              <Building2 className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {stats.data.totalFacilities}
              </div>
              <p className="text-xs text-muted-foreground">
                {stats.data.activeFacilities} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Vendors
              </CardTitle>
              <Truck className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.data.totalVendors}</div>
              <p className="text-xs text-muted-foreground">
                {stats.data.activeVendors} active
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Total Users
              </CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.data.totalUsers}</div>
              <p className="text-xs text-muted-foreground">
                {stats.data.activeUsers} active this month
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Monthly Revenue
              </CardTitle>
              <DollarSign className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${(stats.data.mrr / 1000).toFixed(1)}K
              </div>
              <div className="flex items-center text-xs text-green-600 dark:text-green-400">
                <TrendingUp className="h-3 w-3 mr-1" />
                +12.4% from last month
              </div>
            </CardContent>
          </Card>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-[120px] rounded-xl" />
          ))}
        </div>
      )}

      {/* Quick Access & Activity */}
      <div className="grid gap-6 md:grid-cols-2">
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

        {/* Recent Activity */}
        {activity.data ? (
          <ActivityFeed activities={activity.data} />
        ) : (
          <Skeleton className="h-[380px] rounded-xl" />
        )}
      </div>

      {/* Platform Stats */}
      <Card>
        <CardHeader>
          <CardTitle>Platform Performance</CardTitle>
          <CardDescription>
            Contract processing and engagement metrics
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-3">
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">
                Contracts Processed
              </p>
              <p className="text-2xl font-bold">
                {stats.data ? stats.data.totalContracts.toLocaleString() : "--"}
              </p>
              <p className="text-xs text-muted-foreground">Lifetime total</p>
            </div>
            <div className="space-y-1">
              <p className="text-sm text-muted-foreground">Active Contracts</p>
              <p className="text-2xl font-bold">
                {stats.data
                  ? stats.data.activeContracts.toLocaleString()
                  : "--"}
              </p>
              <p className="text-xs text-muted-foreground">
                Currently being tracked
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
  )
}
