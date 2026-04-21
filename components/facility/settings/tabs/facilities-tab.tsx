import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Building2 } from "lucide-react"
import type { FacilityProfile } from "@/lib/actions/settings"

export interface FacilitiesTabProps {
  profileData: FacilityProfile | undefined
}

export function FacilitiesTab({ profileData }: FacilitiesTabProps) {
  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Facility</CardTitle>
          <CardDescription>
            Your account is scoped to a single healthcare facility. Contact
            support to add or change facilities linked to your organization.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {profileData && (
          <div className="flex items-center justify-between p-4 rounded-lg border">
            <div className="flex items-center gap-4">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">{profileData.name}</p>
                <p className="text-sm text-muted-foreground">
                  {profileData.type
                    ? profileData.type.charAt(0).toUpperCase() + profileData.type.slice(1)
                    : "Hospital"}
                  {profileData.city && ` -- ${profileData.city}, ${profileData.state}`}
                </p>
              </div>
            </div>
            <Badge className="bg-green-100 dark:bg-green-900/30 text-green-800 dark:text-green-300">Active</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
