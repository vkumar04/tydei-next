import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ProfileForm } from "@/components/facility/settings/profile-form"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Mail,
  Plus,
  MoreHorizontal,
  Pencil,
  Key,
  Eye,
  EyeOff,
} from "lucide-react"
import type { FacilityProfile } from "@/lib/actions/settings"
import type { UpdateFacilityProfileInput } from "@/lib/validators/settings"

export interface ProfileTabProps {
  profileData: FacilityProfile | undefined
  profileIsLoading: boolean
  showPassword: boolean
  onTogglePassword: () => void
  onSaveProfile: (data: UpdateFacilityProfileInput) => void
  isSavingProfile: boolean
}

export function ProfileTab({
  profileData,
  profileIsLoading,
  showPassword,
  onTogglePassword,
  onSaveProfile,
  isSavingProfile,
}: ProfileTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
        <CardDescription>Manage your account information</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {profileIsLoading ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : profileData ? (
          <div>
            <h3 className="text-lg font-medium mb-4">Profile</h3>
            <div className="flex items-start gap-6">
              <Avatar className="h-20 w-20">
                <AvatarImage src="" />
                <AvatarFallback className="text-lg bg-primary/10 text-primary">
                  {profileData.name
                    .split(" ")
                    .map((n) => n[0])
                    .join("")
                    .slice(0, 2)
                    .toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-3">
                <h3 className="text-lg font-semibold">{profileData.name}</h3>
                <p className="text-sm text-muted-foreground">
                  {profileData.type
                    ? profileData.type.charAt(0).toUpperCase() + profileData.type.slice(1)
                    : "Facility"}
                  {profileData.city && profileData.state
                    ? ` -- ${profileData.city}, ${profileData.state}`
                    : ""}
                </p>
                {profileData.healthSystemName && (
                  <Badge variant="secondary" className="mt-2 text-xs">
                    {profileData.healthSystemName}
                  </Badge>
                )}
                <Button variant="outline" size="sm">
                  Change Avatar
                </Button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 mt-4">
              <div className="space-y-2">
                <Label htmlFor="firstName">First Name</Label>
                <Input
                  id="firstName"
                  defaultValue={profileData.name.split(" ")[0] ?? ""}
                  placeholder="First name"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="lastName">Last Name</Label>
                <Input
                  id="lastName"
                  defaultValue={profileData.name.split(" ").slice(1).join(" ")}
                  placeholder="Last name"
                />
              </div>
            </div>
          </div>
        ) : null}

        <Separator />

        <div>
          <h3 className="text-lg font-medium mb-4">Email addresses</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3 rounded-lg border">
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-muted-foreground" />
                <span>{profileData?.name ? `${profileData.name.toLowerCase().replace(/\s/g, ".")}@facility.org` : "user@facility.org"}</span>
                <Badge variant="secondary" className="text-xs">Primary</Badge>
              </div>
              <Button variant="ghost" size="sm">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
            <Button variant="link" className="text-primary p-0 h-auto">
              <Plus className="h-4 w-4 mr-1" />
              Add an email address
            </Button>
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="text-lg font-medium mb-4">Security</h3>
          <p className="text-sm text-muted-foreground mb-4">Manage your security preferences</p>

          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Password</Label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2 p-3 rounded-lg border flex-1">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono">{showPassword ? "MySecurePass123!" : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}</span>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onTogglePassword}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button variant="link" className="text-primary p-0 h-auto mt-2">
                <Pencil className="h-4 w-4 mr-1" />
                Change password
              </Button>
            </div>

            <div className="flex items-center justify-between p-4 rounded-lg border">
              <div>
                <p className="font-medium">Two-factor authentication</p>
                <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
              </div>
              <Button variant="outline">Enable</Button>
            </div>
          </div>
        </div>

        <Separator />

        {profileIsLoading ? (
          <Skeleton className="h-[300px] rounded-xl" />
        ) : profileData ? (
          <ProfileForm
            facility={profileData}
            onSave={async (data) => {
              onSaveProfile(data)
            }}
            isPending={isSavingProfile}
          />
        ) : null}
      </CardContent>
    </Card>
  )
}
