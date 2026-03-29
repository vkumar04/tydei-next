"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { UserPlus } from "lucide-react"
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
        description="Manage your company profile, team, and connections"
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="connections">Connections</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          {profile.isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : profile.data ? (
            <VendorProfileForm
              vendor={profile.data}
              onSave={async (data) => { updateProfile.mutate(data) }}
              isPending={updateProfile.isPending}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="team" className="mt-4">
          <div className="space-y-4">
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
          </div>
          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            onInvite={async (email, role) => {
              inviteMember.mutate({ email, role, subRole: role })
            }}
            roles={VENDOR_ROLES}
          />
        </TabsContent>

        <TabsContent value="notifications" className="mt-4">
          {prefs.isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : prefs.data ? (
            <NotificationSettings
              preferences={prefs.data}
              onSave={async (p) => { updatePrefs.mutate(p) }}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="connections" className="mt-4">
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
