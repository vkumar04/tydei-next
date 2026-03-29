"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { FeatureFlagData } from "@/lib/actions/settings"

interface FeatureFlagsPanelProps {
  flags: FeatureFlagData
  onToggle: (flag: keyof FeatureFlagData, value: boolean) => void
}

const FLAG_CONFIG: { key: keyof FeatureFlagData; label: string; description: string }[] = [
  { key: "purchaseOrdersEnabled", label: "Purchase Orders", description: "Enable PO creation and management" },
  { key: "aiAgentEnabled", label: "AI Agent", description: "Enable AI-powered contract analysis" },
  { key: "vendorPortalEnabled", label: "Vendor Portal", description: "Allow vendors to access their portal" },
  { key: "advancedReportsEnabled", label: "Advanced Reports", description: "Enable advanced reporting and analytics" },
  { key: "caseCostingEnabled", label: "Case Costing", description: "Enable case costing analysis" },
]

export function FeatureFlagsPanel({ flags, onToggle }: FeatureFlagsPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Feature Flags</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {FLAG_CONFIG.map((flag) => (
          <div key={flag.key} className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">{flag.label}</Label>
              <p className="text-xs text-muted-foreground">{flag.description}</p>
            </div>
            <Switch
              checked={flags[flag.key]}
              onCheckedChange={(v) => onToggle(flag.key, v)}
            />
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
