"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { NotificationPreferences } from "@/lib/validators/settings"

interface NotificationSettingsProps {
  preferences: NotificationPreferences
  onSave: (prefs: NotificationPreferences) => Promise<void>
}

const ALERT_TOGGLES: { key: keyof NotificationPreferences; label: string; description: string }[] = [
  { key: "expiringContracts", label: "Expiring Contracts", description: "Notify when contracts are approaching expiration" },
  { key: "tierThresholds", label: "Tier Thresholds", description: "Notify when spend approaches a new tier" },
  { key: "rebateDue", label: "Rebate Due", description: "Notify when rebates are due for collection" },
  { key: "paymentDue", label: "Payment Due", description: "Notify when payments are due" },
  { key: "offContract", label: "Off-Contract Purchases", description: "Notify on off-contract spending" },
  { key: "pricingErrors", label: "Pricing Errors", description: "Notify when invoice prices differ from contract" },
  { key: "compliance", label: "Compliance", description: "Notify on compliance-related issues" },
]

const CHANNEL_TOGGLES: { key: keyof NotificationPreferences; label: string }[] = [
  { key: "emailEnabled", label: "Email Notifications" },
  { key: "inAppEnabled", label: "In-App Notifications" },
]

export function NotificationSettings({ preferences, onSave }: NotificationSettingsProps) {
  function handleToggle(key: keyof NotificationPreferences, value: boolean) {
    void onSave({ ...preferences, [key]: value })
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Alert Types</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {ALERT_TOGGLES.map((toggle) => (
            <div key={toggle.key} className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">{toggle.label}</Label>
                <p className="text-xs text-muted-foreground">{toggle.description}</p>
              </div>
              <Switch
                checked={preferences[toggle.key] as boolean}
                onCheckedChange={(v) => handleToggle(toggle.key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Notification Channels</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {CHANNEL_TOGGLES.map((toggle) => (
            <div key={toggle.key} className="flex items-center justify-between">
              <Label className="text-sm font-medium">{toggle.label}</Label>
              <Switch
                checked={preferences[toggle.key] as boolean}
                onCheckedChange={(v) => handleToggle(toggle.key, v)}
              />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
