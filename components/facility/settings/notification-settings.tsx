"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import type { NotificationPreferences } from "@/lib/validators/settings"

interface NotificationSettingsProps {
  preferences: NotificationPreferences
  onSave: (prefs: NotificationPreferences) => Promise<void>
}

const ALERT_TOGGLES: {
  key: keyof NotificationPreferences
  label: string
  description: string
  group: "alerts" | "reports" | "contracts"
}[] = [
  {
    key: "expiringContracts",
    label: "Contract Expiration Alerts",
    description: "Get notified when contracts are expiring",
    group: "contracts",
  },
  {
    key: "pricingErrors",
    label: "Price Discrepancy Alerts",
    description: "When invoiced prices differ from contract prices",
    group: "alerts",
  },
  {
    key: "offContract",
    label: "Off-Contract Purchase Alerts",
    description: "When purchases are made outside contracts",
    group: "alerts",
  },
  {
    key: "tierThresholds",
    label: "Tier Threshold Alerts",
    description: "Notify when spend approaches a new rebate tier",
    group: "alerts",
  },
  {
    key: "rebateDue",
    label: "Rebate Due Notifications",
    description: "Notify when rebates are due for collection",
    group: "contracts",
  },
  {
    key: "paymentDue",
    label: "Payment Due Notifications",
    description: "Notify when payments are due",
    group: "contracts",
  },
  {
    key: "compliance",
    label: "Compliance Alerts",
    description: "Notify on compliance-related issues",
    group: "alerts",
  },
]

const CHANNEL_TOGGLES: { key: keyof NotificationPreferences; label: string }[] =
  [
    { key: "emailEnabled", label: "Email Notifications" },
    { key: "inAppEnabled", label: "In-App Notifications" },
  ]

export function NotificationSettings({
  preferences,
  onSave,
}: NotificationSettingsProps) {
  function handleToggle(key: keyof NotificationPreferences, value: boolean) {
    void onSave({ ...preferences, [key]: value })
  }

  const alertGroup = ALERT_TOGGLES.filter((t) => t.group === "alerts")
  const contractGroup = ALERT_TOGGLES.filter((t) => t.group === "contracts")

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Notification Preferences</CardTitle>
          <CardDescription>
            Choose how and when you want to be notified
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Alerts group */}
          <div className="space-y-4">
            <h3 className="font-medium">Alerts</h3>
            {alertGroup.map((toggle, i) => (
              <div key={toggle.key}>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{toggle.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {toggle.description}
                    </p>
                  </div>
                  <Switch
                    checked={preferences[toggle.key] as boolean}
                    onCheckedChange={(v) => handleToggle(toggle.key, v)}
                  />
                </div>
                {i < alertGroup.length - 1 && <Separator />}
              </div>
            ))}
          </div>

          <Separator />

          {/* Contracts group */}
          <div className="space-y-4">
            <h3 className="font-medium">Contracts</h3>
            {contractGroup.map((toggle, i) => (
              <div key={toggle.key}>
                <div className="flex items-center justify-between py-3">
                  <div>
                    <p className="font-medium">{toggle.label}</p>
                    <p className="text-sm text-muted-foreground">
                      {toggle.description}
                    </p>
                  </div>
                  <Switch
                    checked={preferences[toggle.key] as boolean}
                    onCheckedChange={(v) => handleToggle(toggle.key, v)}
                  />
                </div>
                {i < contractGroup.length - 1 && <Separator />}
              </div>
            ))}
          </div>
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
