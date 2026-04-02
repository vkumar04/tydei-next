import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"
import { NotificationSettings } from "@/components/facility/settings/notification-settings"
import { Skeleton } from "@/components/ui/skeleton"
import type { NotificationPreferences } from "@/lib/validators/settings"

export interface NotificationsTabProps {
  prefsData: NotificationPreferences | undefined
  prefsIsLoading: boolean
  onSavePrefs: (prefs: NotificationPreferences) => void
}

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
        ) : prefsData ? (
          <NotificationSettings
            preferences={prefsData}
            onSave={async (p) => {
              onSavePrefs(p)
            }}
          />
        ) : (
          <div className="space-y-4">
            <h3 className="font-medium">Email Notifications</h3>

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">Contract Expiration Alerts</p>
                <p className="text-sm text-muted-foreground">Get notified when contracts are expiring</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">Price Discrepancy Alerts</p>
                <p className="text-sm text-muted-foreground">When invoiced prices differ from contract prices</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">Off-Contract Purchase Alerts</p>
                <p className="text-sm text-muted-foreground">When purchases are made outside contracts</p>
              </div>
              <Switch defaultChecked />
            </div>
            <Separator />

            <div className="flex items-center justify-between py-3">
              <div>
                <p className="font-medium">Weekly Summary Reports</p>
                <p className="text-sm text-muted-foreground">Receive weekly performance summaries</p>
              </div>
              <Switch defaultChecked />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
