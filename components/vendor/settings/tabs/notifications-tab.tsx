import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import type { NotificationPreferences } from "@/lib/validators/settings"

export interface NotificationsTabProps {
  prefsData: NotificationPreferences | undefined
  prefsIsLoading: boolean
  onSavePrefs: (prefs: NotificationPreferences) => void
}

interface Row {
  key: keyof NotificationPreferences
  title: string
  description: string
}

const ROWS: Row[] = [
  {
    key: "expiringContracts",
    title: "Contract Submission Updates",
    description: "Get notified when contracts are approved or need revision",
  },
  {
    key: "pricingErrors",
    title: "Purchase Order Alerts",
    description: "Notifications for new POs and status changes",
  },
  {
    key: "tierThresholds",
    title: "Rebate Milestones",
    description: "Alerts when facilities approach rebate tiers",
  },
  {
    key: "compliance",
    title: "Weekly Performance Summary",
    description: "Weekly digest of your contract performance",
  },
]

export function NotificationsTab({
  prefsData,
  prefsIsLoading,
  onSavePrefs,
}: NotificationsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Notification Preferences</CardTitle>
        <CardDescription>Choose how and when you want to be notified</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {prefsIsLoading ? (
          <Skeleton className="h-[400px] rounded-xl" />
        ) : (
          <div className="space-y-4">
            <h3 className="font-medium">Email Notifications</h3>
            {ROWS.map((row, idx) => (
              <div key={row.key}>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{row.title}</p>
                    <p className="text-sm text-muted-foreground">{row.description}</p>
                  </div>
                  <Switch
                    checked={prefsData ? Boolean(prefsData[row.key]) : idx !== ROWS.length - 1}
                    onCheckedChange={(v) => {
                      if (!prefsData) return
                      onSavePrefs({ ...prefsData, [row.key]: v })
                    }}
                    disabled={!prefsData}
                  />
                </div>
                {idx < ROWS.length - 1 && <Separator />}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
