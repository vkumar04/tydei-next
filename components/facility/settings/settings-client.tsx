"use client"

import { useState, useCallback } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
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
  Store,
  FolderTree,
  SlidersHorizontal,
  UserPlus,
  BellRing,
  ShieldCheck,
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
  useUpdateMemberAccessTier,
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
import {
  useCredits,
  useUsageBreakdown,
  useUsageHistory,
} from "@/hooks/use-ai-credits"
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
import { VendorsTab } from "@/components/facility/settings/tabs/vendors-tab"
import { CategoriesTab } from "@/components/facility/settings/tabs/categories-tab"
import { AlertsTab } from "@/components/facility/settings/tabs/alerts-tab"
import { FacilityAssignmentTab } from "@/components/facility/settings/tabs/facility-assignment-tab"

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
  const profile = useFacilityProfile(facilityId)
  const updateProfile = useUpdateFacilityProfile(facilityId)
  const prefs = useNotificationPreferences(facilityId)
  const updatePrefs = useUpdateNotificationPreferences(facilityId)
  const team = useTeamMembers(organizationId)
  const inviteMember = useInviteTeamMember(organizationId)
  const removeMember = useRemoveTeamMember(organizationId)
  const updateRole = useUpdateTeamMemberRole(organizationId)
  const updateAccessTier = useUpdateMemberAccessTier(organizationId)
  const flags = useFeatureFlags(facilityId)
  const updateFlags = useUpdateFeatureFlags(facilityId)
  const connectionData = useConnections(facilityId, "facility")
  const sendInvite = useSendConnectionInvite(facilityId)
  const acceptConn = useAcceptConnection(facilityId)
  const rejectConn = useRejectConnection(facilityId)
  const removeConn = useRemoveConnection(facilityId)
  const creditsQuery = useCredits(facilityId, "facility")
  const usageQuery = useUsageHistory(creditsQuery.data?.id)
  const breakdownQuery = useUsageBreakdown(creditsQuery.data?.id)

  const facilityName = profile.data?.name ?? "Facility"

  const handleSendConnectionInvite = useCallback(() => {
    const name = newInviteVendorName.trim()
    if (!name) return
    // 2026-06-09 settings audit: success used to toast unconditionally,
    // hiding server failures (e.g. "Vendor not found with that email").
    // Toast from the mutation result instead.
    sendInvite.mutate(
      {
        // The invite is resolved by vendor NAME server-side; we no longer
        // fabricate a `contact@<name>.com` email that never matched a real
        // vendor row (Charles: "who does this invite go to?").
        toEmail: "",
        toName: name,
        message: newInviteMessage || undefined,
      },
      {
        onSuccess: () => toast.success(`Connection invite sent to ${name}`),
        onError: (err) =>
          toast.error(
            err instanceof Error ? err.message : "Failed to send connection invite"
          ),
      }
    )
    setNewInviteVendorName("")
    setNewInviteMessage("")
    setInviteVendorDialogOpen(false)
  }, [newInviteVendorName, newInviteMessage, sendInvite])

  const handleUpdateFeatureFlags = useCallback(
    (flagData: Partial<FeatureFlagData>, message: string) => {
      updateFlags.mutate(flagData, {
        onSuccess: () => toast.success(message),
        onError: () => toast.error("Failed to update feature settings"),
      })
    },
    [updateFlags]
  )

  const tabs: Array<{ value: string; label: string; Icon: typeof User }> = [
    { value: "profile", label: "Profile", Icon: User },
    { value: "notifications", label: "Notifications", Icon: Bell },
    { value: "billing", label: "Billing", Icon: CreditCard },
    { value: "members", label: "Members", Icon: Users },
    { value: "access", label: "Facility Access", Icon: ShieldCheck },
    { value: "alerts", label: "Alerts", Icon: BellRing },
    { value: "account", label: "Account", Icon: Settings },
    { value: "facilities", label: "Facilities", Icon: Building2 },
    { value: "connections", label: "Connections", Icon: Link2 },
    { value: "vendors", label: "Vendors", Icon: Store },
    { value: "categories", label: "Categories", Icon: FolderTree },
    { value: "features", label: "Features", Icon: ToggleLeft },
    { value: "ai-credits", label: "AI Credits", Icon: Sparkles },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Workspace
            </div>
            <h1 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">
              {facilityName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage profile, team, billing, connections, and feature access.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setActiveTab("members")}
              className="gap-2"
            >
              <UserPlus className="h-4 w-4" />
              Invite member
            </Button>
            <Button
              size="sm"
              onClick={() => setActiveTab("billing")}
              className="gap-2"
            >
              <CreditCard className="h-4 w-4" />
              Manage billing
            </Button>
          </div>
        </div>
      </section>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1 bg-muted/60 p-1">
          {tabs.map(({ value, label, Icon }) => (
            <TabsTrigger key={value} value={value} className="gap-2">
              <Icon className="h-4 w-4 hidden sm:inline" />
              {label}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="profile" className="space-y-6">
          <ProfileTab
            profileData={profile.data}
            profileIsLoading={profile.isLoading}
            showPassword={showPassword}
            onTogglePassword={() => setShowPassword((p) => !p)}
            onSaveProfile={(data) => updateProfile.mutate(data)}
            isSavingProfile={updateProfile.isPending}
          />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <NotificationsTab
            prefsData={prefs.data}
            prefsIsLoading={prefs.isLoading}
            onSavePrefs={(p) => updatePrefs.mutate(p)}
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
            onRemoveMember={(id) => removeMember.mutate(id)}
            onRoleChange={(id, role) => updateRole.mutate({ memberId: id, role })}
            onInviteMember={(email, role) =>
              inviteMember.mutate(
                { email, role },
                {
                  onSuccess: () => {
                    toast.success(`Invitation sent to ${email}`)
                    setInviteOpen(false)
                  },
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Failed to send invitation",
                    ),
                },
              )
            }
            onAccessTierChange={(id, tier) =>
              updateAccessTier.mutate(
                { memberId: id, tier },
                {
                  onSuccess: () => toast.success("Access level updated"),
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Failed to update access level",
                    ),
                },
              )
            }
          />
        </TabsContent>

        <TabsContent value="access" className="space-y-6">
          <FacilityAssignmentTab
            orgId={organizationId}
            canManage
          />
        </TabsContent>

        <TabsContent value="alerts" className="space-y-6">
          <AlertsTab />
        </TabsContent>

        <TabsContent value="account" className="space-y-6">
          <AccountTab
            profileData={profile.data}
            flagsData={flags.data}
            onUpdateFlags={(f) => updateFlags.mutate(f)}
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
            onAcceptConnection={(id) =>
              acceptConn.mutate(id, {
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : "Failed to accept"),
              })
            }
            onRejectConnection={(id) =>
              rejectConn.mutate(id, {
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : "Failed to reject"),
              })
            }
            onRemoveConnection={(id) =>
              removeConn.mutate(id, {
                onError: (err) =>
                  toast.error(err instanceof Error ? err.message : "Failed to remove"),
              })
            }
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
            breakdownData={breakdownQuery.data}
          />
        </TabsContent>

        <TabsContent value="vendors" className="space-y-6">
          <VendorsTab />
        </TabsContent>

        <TabsContent value="categories" className="space-y-6">
          <CategoriesTab />
        </TabsContent>
      </Tabs>
    </div>
  )
}
