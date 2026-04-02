import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Building2,
  Plus,
} from "lucide-react"
import type { FacilityProfile } from "@/lib/actions/settings"

export interface FacilitiesTabProps {
  profileData: FacilityProfile | undefined
}

export function FacilitiesTab({ profileData }: FacilitiesTabProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Facilities</CardTitle>
            <CardDescription>Manage your healthcare facilities and locations</CardDescription>
          </div>
          <Button>
            <Plus className="mr-2 h-4 w-4" />
            Add Facility
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <Building2 className="h-5 w-5 text-primary" />
              <span className="font-medium">Total Facilities</span>
            </div>
            <p className="mt-2 text-2xl font-bold">1</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">Active</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-green-600 dark:text-green-400">1</p>
          </div>
          <div className="rounded-lg border p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium">Inactive</span>
            </div>
            <p className="mt-2 text-2xl font-bold text-muted-foreground">0</p>
          </div>
        </div>

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
