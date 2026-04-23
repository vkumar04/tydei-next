import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Mail, Key, Eye, EyeOff, Pencil } from "lucide-react"
import type { VendorProfile } from "@/lib/actions/settings"

export interface ProfileTabProps {
  profileData: VendorProfile | undefined
  profileIsLoading: boolean
  showPassword: boolean
  onTogglePassword: () => void
}

export function ProfileTab({
  profileData,
  profileIsLoading,
  showPassword,
  onTogglePassword,
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
            <h3 className="mb-4 text-lg font-medium">Profile</h3>
            <div className="flex items-start gap-6">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="text-lg">
                  {profileData.contactName
                    ? profileData.contactName
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()
                    : profileData.name.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="firstName">First Name</Label>
                    <Input
                      id="firstName"
                      defaultValue={profileData.contactName?.split(" ")[0] || ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="lastName">Last Name</Label>
                    <Input
                      id="lastName"
                      defaultValue={profileData.contactName?.split(" ").slice(1).join(" ") || ""}
                    />
                  </div>
                </div>
                <Button variant="outline" size="sm">
                  Change Avatar
                </Button>
              </div>
            </div>
          </div>
        ) : null}

        <Separator />

        <div>
          <h3 className="mb-4 text-lg font-medium">Email Address</h3>
          <div className="flex items-center justify-between rounded-lg border p-3">
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-muted-foreground" />
              <span>{profileData?.contactEmail || "contact@vendor.com"}</span>
              <Badge variant="secondary" className="text-xs">
                Primary
              </Badge>
            </div>
          </div>
        </div>

        <Separator />

        <div>
          <h3 className="mb-4 text-lg font-medium">Security</h3>
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">Password</Label>
              <div className="flex items-center gap-3">
                <div className="flex flex-1 items-center gap-2 rounded-lg border p-3">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <span className="font-mono">
                    {showPassword ? "MySecurePass123!" : "••••••••••"}
                  </span>
                </div>
                <Button variant="ghost" size="icon" onClick={onTogglePassword}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <Button variant="link" className="mt-2 h-auto p-0 text-primary">
                <Pencil className="mr-1 h-4 w-4" />
                Change password
              </Button>
            </div>

            <div className="flex items-center justify-between rounded-lg border p-4">
              <div>
                <p className="font-medium">Two-factor authentication</p>
                <p className="text-sm text-muted-foreground">Add an extra layer of security</p>
              </div>
              <Button variant="outline">Enable</Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
