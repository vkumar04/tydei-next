import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import type { FacilityProfile } from "@/lib/actions/settings"
import type { FeatureFlagData } from "@/lib/actions/settings"

export interface AccountTabProps {
  profileData: FacilityProfile | undefined
  flagsData: FeatureFlagData | undefined
  onUpdateFlags: (flags: Partial<FeatureFlagData>) => void
}

export function AccountTab({
  profileData,
  flagsData,
  onUpdateFlags,
}: AccountTabProps) {
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Organization Settings</CardTitle>
          <CardDescription>Manage your organization details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="orgName">Organization Name</Label>
              <Input id="orgName" defaultValue={profileData?.healthSystemName || "Organization"} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="orgType">Organization Type</Label>
              <Input id="orgType" defaultValue={profileData?.type || "Health System"} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="address">Address</Label>
              <Input id="address" defaultValue={profileData?.address || ""} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="city">City, State, ZIP</Label>
              <Input id="city" defaultValue={profileData?.city && profileData?.state ? `${profileData.city}, ${profileData.state}` : ""} />
            </div>
          </div>
          <Button>Save Organization Settings</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Feature Modules</CardTitle>
          <CardDescription>Enable or disable optional features</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {flagsData && (
            <>
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">Purchase Order Module</p>
                  <p className="text-sm text-muted-foreground">Enable digital PO creation and tracking</p>
                </div>
                <Switch
                  checked={flagsData.purchaseOrdersEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags({ purchaseOrdersEnabled: checked })
                  }}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">AI Contract Parsing</p>
                  <p className="text-sm text-muted-foreground">Use AI to extract contract terms from PDFs</p>
                </div>
                <Switch
                  checked={flagsData.aiAgentEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags({ aiAgentEnabled: checked })
                  }}
                />
              </div>
              <Separator />
              <div className="flex items-center justify-between py-3">
                <div>
                  <p className="font-medium">Surgeon Scorecard</p>
                  <p className="text-sm text-muted-foreground">Track surgeon performance and margins</p>
                </div>
                <Switch
                  checked={flagsData.caseCostingEnabled}
                  onCheckedChange={(checked) => {
                    onUpdateFlags({ caseCostingEnabled: checked })
                  }}
                />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>Irreversible actions for your account</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/20">
            <div>
              <p className="font-medium">Export All Data</p>
              <p className="text-sm text-muted-foreground">Download all your organization data</p>
            </div>
            <Button variant="outline">Export</Button>
          </div>
          <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/20">
            <div>
              <p className="font-medium text-destructive">Delete Organization</p>
              <p className="text-sm text-muted-foreground">Permanently delete all data</p>
            </div>
            <Button variant="destructive">Delete</Button>
          </div>
        </CardContent>
      </Card>
    </>
  )
}
