import { UserPlus, FileText, AlertCircle } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { formatDate } from "@/lib/formatting"
import type { ActivityEntry } from "@/lib/actions/admin/dashboard"

const typeIcons = {
  user_created: UserPlus,
  facility_created: UserPlus,
  contract_created: FileText,
  alert: AlertCircle,
} as const

const typeLabels = {
  user_created: "User",
  facility_created: "Facility",
  contract_created: "Contract",
  alert: "Alert",
} as const

interface ActivityFeedProps {
  activities: ActivityEntry[]
}

export function ActivityFeed({ activities }: ActivityFeedProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ScrollArea className="h-[320px]">
          <div className="space-y-3">
            {activities.map((activity) => {
              const Icon = typeIcons[activity.type]
              return (
                <div key={activity.id} className="flex items-start gap-3">
                  <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted">
                    <Icon className="size-3.5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm leading-snug">{activity.description}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {typeLabels[activity.type]}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {formatDate(activity.timestamp)}
                      </span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  )
}
