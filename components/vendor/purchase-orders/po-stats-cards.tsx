import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Clock,
  CheckCircle2,
  XCircle,
  Package,
} from "lucide-react"
import type { POStats } from "./types"

export interface POStatsCardsProps {
  stats: POStats
}

export function POStatsCards({ stats }: POStatsCardsProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
      <Card
        className={
          stats.pendingApproval > 0
            ? "border-orange-200 bg-orange-50/50 dark:border-orange-900 dark:bg-orange-950/20"
            : ""
        }
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Pending Approval</CardTitle>
          <Clock
            className={`h-4 w-4 ${stats.pendingApproval > 0 ? "text-orange-600" : "text-muted-foreground"}`}
          />
        </CardHeader>
        <CardContent>
          <div
            className={`text-2xl font-bold ${stats.pendingApproval > 0 ? "text-orange-600" : ""}`}
          >
            {stats.pendingApproval}
          </div>
          <p className="text-xs text-muted-foreground">Awaiting facility approval</p>
        </CardContent>
      </Card>
      <Card
        className={
          stats.approved > 0
            ? "border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20"
            : ""
        }
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Approved</CardTitle>
          <CheckCircle2
            className={`h-4 w-4 ${stats.approved > 0 ? "text-green-600 dark:text-green-400" : "text-muted-foreground"}`}
          />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${stats.approved > 0 ? "text-green-600 dark:text-green-400" : ""}`}>
            {stats.approved}
          </div>
          <p className="text-xs text-muted-foreground">Ready to process</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">In Progress</CardTitle>
          <Package className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.inProgress}</div>
          <p className="text-xs text-muted-foreground">Processing & shipping</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Fulfilled</CardTitle>
          <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          <div className="text-2xl font-bold">{stats.fulfilled}</div>
          <p className="text-xs text-muted-foreground">Completed orders</p>
        </CardContent>
      </Card>
      <Card
        className={
          stats.rejected > 0
            ? "border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20"
            : ""
        }
      >
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">Rejected</CardTitle>
          <XCircle
            className={`h-4 w-4 ${stats.rejected > 0 ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}
          />
        </CardHeader>
        <CardContent>
          <div className={`text-2xl font-bold ${stats.rejected > 0 ? "text-red-600 dark:text-red-400" : ""}`}>
            {stats.rejected}
          </div>
          <p className="text-xs text-muted-foreground">Declined by facility</p>
        </CardContent>
      </Card>
    </div>
  )
}
