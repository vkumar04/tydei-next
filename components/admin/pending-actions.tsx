import { Building2, Clock, CreditCard } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

interface PendingActionsProps {
  actions: {
    newFacilitySetups: number
    trialExpirations: number
    failedPayments: number
  }
}

const items = [
  { key: "newFacilitySetups" as const, label: "New Facility Setups", icon: Building2 },
  { key: "trialExpirations" as const, label: "Trial Expirations (30d)", icon: Clock },
  { key: "failedPayments" as const, label: "Failed Payments", icon: CreditCard },
]

export function PendingActions({ actions }: PendingActionsProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pending Actions</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {items.map(({ key, label, icon: Icon }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-4 text-muted-foreground" />
                </div>
                <span className="text-sm font-medium">{label}</span>
              </div>
              <Badge variant={actions[key] > 0 ? "destructive" : "secondary"}>
                {actions[key]}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
