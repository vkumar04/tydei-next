"use client"

import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"

// Charles 2026-04-25 (audit C1): gpoAffiliation input removed from this
// card and promoted to VendorPhase2FieldsCard so it's reachable for all
// contract types — not just `grouped`. This card now configures only
// multi-facility participation, which is the only group-specific setting
// left.
export interface GroupContractSettingsCardProps {
  isMultiFacility: boolean
  onIsMultiFacilityChange: (checked: boolean) => void
}

export function GroupContractSettingsCard({
  isMultiFacility,
  onIsMultiFacilityChange,
}: GroupContractSettingsCardProps) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-sm">Group Contract Settings</CardTitle>
        <CardDescription>
          Configure multi-facility participation. GPO affiliation is set in
          the Contract Details section below.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Switch
            checked={isMultiFacility}
            onCheckedChange={onIsMultiFacilityChange}
          />
          <Label>Multi-facility contract</Label>
        </div>
        {isMultiFacility && (
          <p className="text-sm text-muted-foreground">
            Select participating facilities in the Basic Information section above.
          </p>
        )}
      </CardContent>
    </Card>
  )
}
