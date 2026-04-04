"use client"

import { useState, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  User,
  Bell,
  CreditCard,
  Users,
  Settings,
  Building2,
  Link2,
  ToggleLeft,
  Sparkles,
  Puzzle,
  Store,
  FolderTree,
} from "lucide-react"
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
import {
  useConnections,
  useSendConnectionInvite,
  useAcceptConnection,
  useRejectConnection,
  useRemoveConnection,
} from "@/hooks/use-connections"
import { useCredits, useUsageHistory } from "@/hooks/use-ai-credits"
import type { FeatureFlagData } from "@/lib/actions/settings"
import { toast } from "sonner"

import { ProfileTab } from "@/components/facility/settings/tabs/profile-tab"
import { NotificationsTab } from "@/components/facility/settings/tabs/notifications-tab"
import { BillingTab } from "@/components/facility/settings/tabs/billing-tab"
import { MembersTab } from "@/components/facility/settings/tabs/members-tab"
import { AccountTab } from "@/components/facility/settings/tabs/account-tab"
import { FacilitiesTab } from "@/components/facility/settings/tabs/facilities-tab"
import { ConnectionsTab } from "@/components/facility/settings/tabs/connections-tab"
import { FeaturesTab } from "@/components/facility/settings/tabs/features-tab"
import { AICreditsTab } from "@/components/facility/settings/tabs/ai-credits-tab"
import { AddonsTab } from "@/components/facility/settings/tabs/addons-tab"
import { VendorsTab } from "@/components/facility/settings/tabs/vendors-tab"
import { CategoriesTab } from "@/components/facility/settings/tabs/categories-tab"

interface SettingsClientProps {
  facilityId: string
  organizationId: string
}

export function SettingsClient({ facilityId, organizationId }: SettingsClientProps) {
  const [activeTab, setActiveTab] = useState("profile")
  const [inviteOpen, setInviteOpen] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [inviteVendorDialogOpen, setInviteVendorDialogOpen] = useState(false)
  const [newInviteVendorName, setNewInviteVendorName] = useState("")
  const [newInviteMessage, setNewInviteMessage] = useState("")
  const [addonsState, setAddonsState] = useState<Record<string, boolean>>({
    predictive_forecasting: false,
    ai_contract_analysis: true,
    cost_modeling: false,
  })

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
  const connectionData = useConnections(facilityId, "facility")
  const sendInvite = useSendConnectionInvite(facilityId)
  const acceptConn = useAcceptConnection(facilityId)
  const rejectConn = useRejectConnection(facilityId)
  const removeConn = useRemoveConnection(facilityId)
  const creditsQuery = useCredits(facilityId, "facility")
  const usageQuery = useUsageHistory(creditsQuery.data?.id)

  const facilityName = profile.data?.name ?? "Facility"

  const handleTogglePassword = useCallback(() => {
    setShowPassword((prev) => !prev)
  }, [])

  const handleSaveProfile = useCallback(
    (data: Parameters<typeof updateProfile.mutate>[0]) => {
      updateProfile.mutate(data)
    },
    [updateProfile]
  )

  const handleSavePrefs = useCallback(
    (p: Parameters<typeof updatePrefs.mutate>[0]) => {
      updatePrefs.mutate(p)
    },
    [updatePrefs]
  )

  const handleRemoveMember = useCallback(
    (id: string) => {
      removeMember.mutate(id)
    },
    [removeMember]
  )

  const handleRoleChange = useCallback(
    (id: string, role: string) => {
      updateRole.mutate({ memberId: id, role })
    },
    [updateRole]
  )

  const handleInviteMember = useCallback(
    (email: string, role: string) => {
      inviteMember.mutate({ email, role })
    },
    [inviteMember]
  )

  const handleUpdateAccountFlags = useCallback(
    (flagData: Partial<FeatureFlagData>) => {
      updateFlags.mutate(flagData as Partial<FeatureFlagData>)
    },
    [updateFlags]
  )

  const handleUpdateFeatureFlags = useCallback(
    (flagData: Partial<FeatureFlagData>, message: string) => {
      updateFlags.mutate(flagData as Partial<FeatureFlagData>)
      toast.success(message)
    },
    [updateFlags]
  )

  const handleSendConnectionInvite = useCallback(() => {
    if (newInviteVendorName.trim()) {
      sendInvite.mutate({
        fromType: "facility",
        fromId: facilityId,
        fromName: facilityName,
        toEmail: `contact@${newInviteVendorName.trim().toLowerCase().replace(/\s/g, "")}.com`,
        toName: newInviteVendorName.trim(),
        message: newInviteMessage || undefined,
      })
      const name = newInviteVendorName
      setNewInviteVendorName("")
      setNewInviteMessage("")
      setInviteVendorDialogOpen(false)
      toast.success(`Connection invite sent to ${name}`)
    }
  }, [newInviteVendorName, newInviteMessage, facilityId, facilityName, sendInvite])

  const handleAcceptConnection = useCallback(
    (id: string) => {
      acceptConn.mutate(id)
    },
    [acceptConn]
  )

  const handleRejectConnection = useCallback(
    (id: string) => {
      rejectConn.mutate(id)
    },
    [rejectConn]
  )

  const handleRemoveConnection = useCallback(
    (id: string) => {
      removeConn.mutate(id)
    },
    [removeConn]
  )

  const handleToggleAddon = useCallback(
    (key: string) => {
      const wasActive = addonsState[key]
      setAddonsState((prev) => ({
        ...prev,
        [key]: !prev[key],
      }))
      const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      toast.success(wasActive ? `${label} disabled` : `${label} enabled`)
    },
    [addonsState]
  )

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account, team members, and organization settings
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:grid-cols-7">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4 hidden sm:inline" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4 hidden sm:inline" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <CreditCard className="h-4 w-4 hidden sm:inline" />
            Billing
          </TabsTrigger>
          <TabsTrigger value="members" className="gap-2">
            <Users className="h-4 w-4 hidden sm:inline" />
            Members
          </TabsTrigger>
          <TabsTrigger value="account" className="gap-2">
            <Settings className="h-4 w-4 hidden sm:inline" />
            Account
          </TabsTrigger>
          <TabsTrigger value="facilities" className="gap-2">
            <Building2 className="h-4 w-4 hidden sm:inline" />
            Facilities
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-2">
            <Link2 className="h-4 w-4 hidden sm:inline" />
            Connections
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-2">
            <ToggleLeft className="h-4 w-4 hidden sm:inline" />
            Features
          </TabsTrigger>
          <TabsTrigger value="ai-credits" className="gap-2">
            <Sparkles className="h-4 w-4 hidden sm:inline" />
            AI Credits
          </TabsTrigger>
          <TabsTrigger value="vendors" className="gap-2">
            <Store className="h-4 w-4 hidden sm:inline" />
            Vendors
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2">
            <FolderTree className="h-4 w-4 hidden sm:inline" />
            Categories
          </TabsTrigger>
          <TabsTrigger value="addons" className="gap-2">
            <Puzzle className="h-4 w-4 hidden sm:inline" />
            Add-ons
          </TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileTab
            profileData={profile.data}
            profileIsLoading={profile.isLoading}
            showPassword={showPassword}
            onTogglePassword={handleTogglePassword}
            onSaveProfile={handleSaveProfile}
            isSavingProfile={updateProfile.isPending}
          />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <NotificationsTab
            prefsData={prefs.data}
            prefsIsLoading={prefs.isLoading}
            onSavePrefs={handleSavePrefs}
          />
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <BillingTab />
        </TabsContent>

        <TabsContent value="members" className="space-y-6">
          <MembersTab
            teamData={team.data}
            teamIsLoading={team.isLoading}
            inviteOpen={inviteOpen}
            onSetInviteOpen={setInviteOpen}
            onRemoveMember={handleRemoveMember}
            onRoleChange={handleRoleChange}
            onInviteMember={handleInviteMember}
          />
        </TabsContent>

        <TabsContent value="account" className="space-y-6">
          <AccountTab
            profileData={profile.data}
            flagsData={flags.data}
            onUpdateFlags={handleUpdateAccountFlags}
          />
        </TabsContent>

        <TabsContent value="facilities" className="space-y-6">
          <FacilitiesTab profileData={profile.data} />
        </TabsContent>

        <TabsContent value="connections" className="space-y-6">
          <ConnectionsTab
            connectionData={connectionData.data}
            connectionIsLoading={connectionData.isLoading}
            inviteVendorDialogOpen={inviteVendorDialogOpen}
            onSetInviteVendorDialogOpen={setInviteVendorDialogOpen}
            newInviteVendorName={newInviteVendorName}
            onSetNewInviteVendorName={setNewInviteVendorName}
            newInviteMessage={newInviteMessage}
            onSetNewInviteMessage={setNewInviteMessage}
            onSendInvite={handleSendConnectionInvite}
            onAcceptConnection={handleAcceptConnection}
            onRejectConnection={handleRejectConnection}
            onRemoveConnection={handleRemoveConnection}
          />
        </TabsContent>

        <TabsContent value="features" className="space-y-6">
          <FeaturesTab
            flagsData={flags.data}
            flagsIsLoading={flags.isLoading}
            onUpdateFlags={handleUpdateFeatureFlags}
          />
        </TabsContent>

        <TabsContent value="ai-credits" className="space-y-6">
          <AICreditsTab
            creditsData={creditsQuery.data}
            usageData={usageQuery.data}
          />
        </TabsContent>

        <TabsContent value="vendors" className="space-y-6">
          <VendorsTab />
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          <CategoriesTab />
        </TabsContent>

        <TabsContent value="addons" className="space-y-6">
          <AddonsTab
            addonsState={addonsState}
            onToggleAddon={handleToggleAddon}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}
