"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import {
  User,
  Bell,
  Building2,
  Link2,
  UserPlus,
} from "lucide-react"
import { VendorProfileForm } from "@/components/vendor/settings/vendor-profile-form"
import { NotificationSettings } from "@/components/facility/settings/notification-settings"
import { TeamTable } from "@/components/shared/settings/team-table"
import { InviteMemberDialog } from "@/components/shared/settings/invite-member-dialog"
import { ConnectionManager } from "@/components/vendor/settings/connection-manager"
import {
  useVendorProfile,
  useUpdateVendorProfile,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useVendorTeamMembers,
  useInviteVendorTeamMember,
  useRemoveTeamMember,
  useUpdateTeamMemberRole,
} from "@/hooks/use-settings"
import {
  useConnections,
  useSendConnectionInvite,
  useAcceptConnection,
  useRejectConnection,
  useRemoveConnection,
} from "@/hooks/use-connections"

interface VendorSettingsClientProps {
  vendorId: string
  vendorName: string
  organizationId: string
}

const VENDOR_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "manager", label: "Manager" },
  { value: "rep", label: "Rep" },
]

export function VendorSettingsClient({
  vendorId,
  vendorName,
  organizationId,
}: VendorSettingsClientProps) {
  const [activeTab, setActiveTab] = useState("profile")
  const [inviteOpen, setInviteOpen] = useState(false)

  const profile = useVendorProfile(vendorId)
  const updateProfile = useUpdateVendorProfile(vendorId)
  const prefs = useNotificationPreferences(vendorId)
  const updatePrefs = useUpdateNotificationPreferences(vendorId)
  const team = useVendorTeamMembers(organizationId)
  const inviteMember = useInviteVendorTeamMember(organizationId)
  const removeMember = useRemoveTeamMember(organizationId)
  const updateRole = useUpdateTeamMemberRole(organizationId)
  const connections = useConnections(vendorId, "vendor")
  const sendInvite = useSendConnectionInvite(vendorId)
  const accept = useAcceptConnection(vendorId)
  const reject = useRejectConnection(vendorId)
  const remove = useRemoveConnection(vendorId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage your account and organization settings"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList>
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4 hidden sm:inline" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4 hidden sm:inline" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <UserPlus className="h-4 w-4 hidden sm:inline" />
            Team
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-2">
            <Link2 className="h-4 w-4 hidden sm:inline" />
            Connections
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          {profile.isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : profile.data ? (
            <>
              <VendorProfileForm
                vendor={profile.data}
                onSave={async (data) => {
                  updateProfile.mutate(data)
                }}
                isPending={updateProfile.isPending}
              />

              {/* Organization Details Card matching v0 */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Organization Details</CardTitle>
                  <CardDescription>Company divisions and structure</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Company Name</Label>
                      <Input defaultValue={profile.data.name} disabled />
                    </div>
                    <div className="space-y-2">
                      <Label>Primary Contact Email</Label>
                      <Input defaultValue={profile.data.contactEmail ?? ""} disabled />
                    </div>
                  </div>

                  <Separator />

                  <div>
                    <h3 className="font-medium mb-4">Divisions</h3>
                    <div className="space-y-2">
                      {profile.data.division ? (
                        <div className="flex items-center justify-between p-3 rounded-lg border">
                          <span>{profile.data.division}</span>
                          <Badge variant="secondary">Active</Badge>
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No divisions configured</p>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </>
          ) : null}
        </TabsContent>

        {/* Notifications Tab */}
        <TabsContent value="notifications" className="space-y-6">
          {prefs.isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : prefs.data ? (
            <NotificationSettings
              preferences={prefs.data}
              onSave={async (p) => {
                updatePrefs.mutate(p)
              }}
            />
          ) : (
            /* Fallback notification toggles matching v0 layout */
            <Card>
              <CardHeader>
                <CardTitle>Notification Preferences</CardTitle>
                <CardDescription>Choose how and when you want to be notified</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-4">
                  <h3 className="font-medium">Email Notifications</h3>

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Contract Submission Updates</p>
                      <p className="text-sm text-muted-foreground">
                        Get notified when contracts are approved or need revision
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Purchase Order Alerts</p>
                      <p className="text-sm text-muted-foreground">
                        Notifications for new POs and status changes
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Rebate Milestones</p>
                      <p className="text-sm text-muted-foreground">
                        Alerts when facilities approach rebate tiers
                      </p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Weekly Performance Summary</p>
                      <p className="text-sm text-muted-foreground">
                        Weekly digest of your contract performance
                      </p>
                    </div>
                    <Switch />
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* Team Tab */}
        <TabsContent value="team" className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={() => setInviteOpen(true)}>
              <UserPlus className="mr-1.5 size-4" />
              Invite Member
            </Button>
          </div>
          {team.isLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : team.data ? (
            <TeamTable
              members={team.data}
              onRemove={(id) => removeMember.mutate(id)}
              onRoleChange={(id, role) => updateRole.mutate({ memberId: id, role })}
              isAdmin
              roles={VENDOR_ROLES}
            />
          ) : null}
          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            onInvite={async (email, role) => {
              inviteMember.mutate({ email, role, subRole: role })
            }}
            roles={VENDOR_ROLES}
          />
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="space-y-6">
          {connections.isLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : connections.data ? (
            <ConnectionManager
              connections={connections.data}
              onAccept={(id) => accept.mutate(id)}
              onReject={(id) => reject.mutate(id)}
              onRemove={(id) => remove.mutate(id)}
              onInvite={(email, name, message) =>
                sendInvite.mutate({
                  fromType: "vendor",
                  fromId: vendorId,
                  fromName: vendorName,
                  toEmail: email,
                  toName: name,
                  message,
                })
              }
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
