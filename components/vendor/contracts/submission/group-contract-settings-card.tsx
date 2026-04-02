"use client"

import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export interface GroupContractSettingsCardProps {
  gpoAffiliation: string
  onGpoAffiliationChange: (value: string) => void
  isMultiFacility: boolean
  onIsMultiFacilityChange: (checked: boolean) => void
}

export function GroupContractSettingsCard({
  gpoAffiliation,
  onGpoAffiliationChange,
  isMultiFacility,
  onIsMultiFacilityChange,
}: GroupContractSettingsCardProps) {
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader>
        <CardTitle className="text-sm">Group Contract Settings</CardTitle>
        <CardDescription>
          Configure GPO affiliation and multi-facility participation
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="gpoAffiliation">GPO Affiliation</Label>
          <Input
            id="gpoAffiliation"
            value={gpoAffiliation}
            onChange={(e) => onGpoAffiliationChange(e.target.value)}
            placeholder="e.g., Vizient, Premier, HealthTrust"
          />
        </div>
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
