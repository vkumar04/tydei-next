import { Building2, Truck, Users, DollarSign } from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"
import type { ActivityEntry } from "@/lib/actions/admin/dashboard"

interface ActivityFeedProps {
  activities: ActivityEntry[]
}

const typeConfig: Record<
  string,
  { icon: typeof Building2; bg: string; color: string; label: string }
> = {
  facility_created: {
    icon: Building2,
    bg: "bg-blue-100 dark:bg-blue-900",
    color: "text-blue-600 dark:text-blue-400",
    label: "Facility",
  },
  user_created: {
    icon: Users,
    bg: "bg-purple-100 dark:bg-purple-900",
    color: "text-purple-600 dark:text-purple-400",
    label: "User",
  },
  contract_created: {
    icon: Truck,
    bg: "bg-green-100 dark:bg-green-900",
    color: "text-green-600 dark:text-green-400",
    label: "Vendor",
  },
  alert: {
    icon: DollarSign,
    bg: "bg-amber-100 dark:bg-amber-900",
    color: "text-amber-600 dark:text-amber-400",
    label: "Billing",
  },
}

function timeAgo(timestamp: string): string {
  const diff = Date.now() - new Date(timestamp).getTime()
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(hours / 24)
  if (days > 0) return `${days} day${days === 1 ? "" : "s"} ago`
  if (hours > 0) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const minutes = Math.floor(diff / (1000 * 60))
  if (minutes > 0) return `${minutes} min${minutes === 1 ? "" : "s"} ago`
  return "just now"
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent Activity</CardTitle>
        <CardDescription>Latest platform activity</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {activities.map((activity) => {
            const cfg = typeConfig[activity.type] ?? typeConfig.alert
            const Icon = cfg.icon
            return (
              <div key={activity.id} className="flex items-start gap-3">
                <div
                  className={cn(
                    "mt-0.5 flex h-8 w-8 items-center justify-center rounded-full",
                    cfg.bg
                  )}
                >
                  <Icon className={cn("h-4 w-4", cfg.color)} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium">{cfg.label}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {activity.description}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {timeAgo(activity.timestamp)}
                </span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
