"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { VendorList } from "@/components/facility/vendors/vendor-list"
import { VendorMappingTable } from "@/components/facility/vendors/vendor-mapping-table"
import { CategoryTree } from "@/components/facility/categories/category-tree"
import { ProfileForm } from "@/components/facility/settings/profile-form"
import { NotificationSettings } from "@/components/facility/settings/notification-settings"
import { FeatureFlagsPanel } from "@/components/facility/settings/feature-flags-panel"
import { TeamTable } from "@/components/shared/settings/team-table"
import { InviteMemberDialog } from "@/components/shared/settings/invite-member-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import { UserPlus } from "lucide-react"
import {
  useFacilityProfile,
  useUpdateFacilityProfile,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
  useTeamMembers,
  useInviteTeamMember,
  useRemoveTeamMember,
  useUpdateTeamMemberRole,
  useFeatureFlags,
  useUpdateFeatureFlags,
} from "@/hooks/use-settings"
import type { FeatureFlagData } from "@/lib/actions/settings"

interface SettingsClientProps {
  facilityId: string
  organizationId: string
}

const TEAM_ROLES = [
  { value: "admin", label: "Admin" },
  { value: "member", label: "Member" },
  { value: "viewer", label: "Viewer" },
]

export function SettingsClient({ facilityId, organizationId }: SettingsClientProps) {
  const [inviteOpen, setInviteOpen] = useState(false)

  const profile = useFacilityProfile(facilityId)
  const updateProfile = useUpdateFacilityProfile(facilityId)
  const prefs = useNotificationPreferences(facilityId)
  const updatePrefs = useUpdateNotificationPreferences(facilityId)
  const team = useTeamMembers(organizationId)
  const inviteMember = useInviteTeamMember(organizationId)
  const removeMember = useRemoveTeamMember(organizationId)
  const updateRole = useUpdateTeamMemberRole(organizationId)
  const flags = useFeatureFlags(facilityId)
  const updateFlags = useUpdateFeatureFlags(facilityId)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Manage facility profile, team, notifications, and system configuration"
      />

      <Tabs defaultValue="profile">
        <TabsList>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="vendors">Vendors</TabsTrigger>
          <TabsTrigger value="team">Team</TabsTrigger>
          <TabsTrigger value="flags">Feature Flags</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-4">
          {profile.isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : profile.data ? (
            <ProfileForm
              facility={profile.data}
              onSave={async (data) => { updateProfile.mutate(data) }}
              isPending={updateProfile.isPending}
            />
          ) : null}
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

        <TabsContent value="vendors" className="mt-4 space-y-4">
          <VendorList />
          <VendorMappingTable />
          <CategoryTree />
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
                roles={TEAM_ROLES}
              />
            ) : null}
          </div>
          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            onInvite={async (email, role) => { inviteMember.mutate({ email, role }) }}
            roles={TEAM_ROLES}
          />
        </TabsContent>

        <TabsContent value="flags" className="mt-4">
          {flags.isLoading ? (
            <Skeleton className="h-[300px] rounded-xl" />
          ) : flags.data ? (
            <FeatureFlagsPanel
              flags={flags.data}
              onToggle={(flag, value) =>
                updateFlags.mutate({ [flag]: value } as Partial<FeatureFlagData>)
              }
            />
          ) : null}
        </TabsContent>
      </Tabs>
    </div>
  )
}
