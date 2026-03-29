"use client"

import { useState } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ProfileForm } from "@/components/facility/settings/profile-form"
import { NotificationSettings } from "@/components/facility/settings/notification-settings"
import { FeatureFlagsPanel } from "@/components/facility/settings/feature-flags-panel"
import { TeamTable } from "@/components/shared/settings/team-table"
import { InviteMemberDialog } from "@/components/shared/settings/invite-member-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  User,
  Bell,
  Users,
  ToggleLeft,
  UserPlus,
  ShoppingCart,
  Bot,
  Sparkles,
  Truck,
  Stethoscope,
  UserCog,
  AlertTriangle,
} from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import { toast } from "sonner"

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
  const [activeTab, setActiveTab] = useState("profile")
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
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Settings"
        description="Manage your account, team members, and organization settings"
      />

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4 hidden sm:inline" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="team" className="gap-2">
            <Users className="h-4 w-4 hidden sm:inline" />
            Team
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4 hidden sm:inline" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="features" className="gap-2">
            <ToggleLeft className="h-4 w-4 hidden sm:inline" />
            Features
          </TabsTrigger>
        </TabsList>

        {/* ─── Profile Tab ───────────────────────────────────────── */}
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Manage your account and facility information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Avatar + Name display */}
              {profile.isLoading ? (
                <Skeleton className="h-20 w-full rounded-xl" />
              ) : profile.data ? (
                <div className="flex items-start gap-6">
                  <Avatar className="h-20 w-20">
                    <AvatarImage src="" />
                    <AvatarFallback className="text-lg bg-primary/10 text-primary">
                      {profile.data.name
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold">{profile.data.name}</h3>
                    <p className="text-sm text-muted-foreground">
                      {profile.data.type
                        ? profile.data.type.charAt(0).toUpperCase() + profile.data.type.slice(1)
                        : "Facility"}
                      {profile.data.city && profile.data.state
                        ? ` -- ${profile.data.city}, ${profile.data.state}`
                        : ""}
                    </p>
                    {profile.data.healthSystemName && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        {profile.data.healthSystemName}
                      </Badge>
                    )}
                  </div>
                </div>
              ) : null}

              <Separator />

              {/* Facility form */}
              {profile.isLoading ? (
                <Skeleton className="h-[300px] rounded-xl" />
              ) : profile.data ? (
                <ProfileForm
                  facility={profile.data}
                  onSave={async (data) => {
                    updateProfile.mutate(data)
                  }}
                  isPending={updateProfile.isPending}
                />
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Team Tab ──────────────────────────────────────────── */}
        <TabsContent value="team" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Team Members</CardTitle>
                  <CardDescription>
                    Manage users and their access levels
                  </CardDescription>
                </div>
                <Button onClick={() => setInviteOpen(true)}>
                  <UserPlus className="mr-2 h-4 w-4" />
                  Invite Member
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {/* Role legend */}
              <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Badge className="bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400">
                    Admin
                  </Badge>
                  <span className="text-sm">Full system access</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    Member
                  </Badge>
                  <span className="text-sm">Standard access</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge className="bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400">
                    Viewer
                  </Badge>
                  <span className="text-sm">Read-only</span>
                </div>
              </div>

              {team.isLoading ? (
                <Skeleton className="h-[300px] rounded-xl" />
              ) : team.data ? (
                <TeamTable
                  members={team.data}
                  onRemove={(id) => removeMember.mutate(id)}
                  onRoleChange={(id, role) =>
                    updateRole.mutate({ memberId: id, role })
                  }
                  isAdmin
                  roles={TEAM_ROLES}
                />
              ) : null}
            </CardContent>
          </Card>

          <InviteMemberDialog
            open={inviteOpen}
            onOpenChange={setInviteOpen}
            onInvite={async (email, role) => {
              inviteMember.mutate({ email, role })
            }}
            roles={TEAM_ROLES}
          />
        </TabsContent>

        {/* ─── Notifications Tab ─────────────────────────────────── */}
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
          ) : null}
        </TabsContent>

        {/* ─── Features Tab ──────────────────────────────────────── */}
        <TabsContent value="features" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Feature Settings</CardTitle>
              <CardDescription>
                Enable or disable optional features in the application
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {flags.isLoading ? (
                <Skeleton className="h-[300px] rounded-xl" />
              ) : flags.data ? (
                <>
                  {/* Purchase Orders */}
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                        <ShoppingCart className="h-5 w-5 text-primary" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-base font-medium">
                          Purchase Orders
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Enable PO matching and tracking functionality. When
                          enabled, Purchase Orders will appear in the navigation
                          menu.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={flags.data.purchaseOrdersEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({
                          purchaseOrdersEnabled: checked,
                        } as Partial<FeatureFlagData>)
                        toast.success(
                          checked
                            ? "Purchase Orders enabled"
                            : "Purchase Orders disabled"
                        )
                      }}
                    />
                  </div>

                  {/* AI Agent */}
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-purple-100 dark:bg-purple-900/30">
                        <Bot className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-base font-medium">
                          AI Agent
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Enable the AI-powered assistant for contract analysis,
                          recommendations, and insights.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={flags.data.aiAgentEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({
                          aiAgentEnabled: checked,
                        } as Partial<FeatureFlagData>)
                        toast.success(
                          checked ? "AI Agent enabled" : "AI Agent disabled"
                        )
                      }}
                    />
                  </div>

                  {/* Advanced Reports */}
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-100 dark:bg-amber-900/30">
                        <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-base font-medium">
                          Advanced Reports
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Enable advanced reporting features including custom
                          report builder and scheduled reports.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={flags.data.advancedReportsEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({
                          advancedReportsEnabled: checked,
                        } as Partial<FeatureFlagData>)
                        toast.success(
                          checked
                            ? "Advanced Reports enabled"
                            : "Advanced Reports disabled"
                        )
                      }}
                    />
                  </div>

                  {/* Vendor Portal */}
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
                        <Truck className="h-5 w-5 text-green-600 dark:text-green-400" />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-base font-medium">
                          Vendor Portal
                        </Label>
                        <p className="text-sm text-muted-foreground">
                          Allow vendors to access their dedicated portal for
                          contract submissions and performance tracking.
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={flags.data.vendorPortalEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({
                          vendorPortalEnabled: checked,
                        } as Partial<FeatureFlagData>)
                        toast.success(
                          checked
                            ? "Vendor Portal enabled"
                            : "Vendor Portal disabled"
                        )
                      }}
                    />
                  </div>

                  {/* Premium add-ons section */}
                  <div className="pt-4 border-t">
                    <div className="flex items-center gap-2 mb-4">
                      <Badge
                        variant="secondary"
                        className="bg-gradient-to-r from-amber-500/20 to-orange-500/20 text-amber-700 dark:text-amber-400 border-amber-300 dark:border-amber-700"
                      >
                        Premium Add-Ons
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        Additional modules available for purchase
                      </p>
                    </div>

                    {/* Case Costing */}
                    <div className="flex items-center justify-between rounded-lg border p-4 mb-4 bg-gradient-to-r from-teal-50/50 to-cyan-50/50 dark:from-teal-950/20 dark:to-cyan-950/20 border-teal-200 dark:border-teal-800">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
                          <Stethoscope className="h-5 w-5 text-teal-600 dark:text-teal-400" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Label className="text-base font-medium">
                              Case Costing
                            </Label>
                            <Badge
                              variant="outline"
                              className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                            >
                              Paid Add-On
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Track procedure-level costs, link purchasing data to
                            clinical cases, and analyze margin performance.
                          </p>
                        </div>
                      </div>
                      <Switch
                        checked={flags.data.caseCostingEnabled}
                        onCheckedChange={(checked) => {
                          updateFlags.mutate({
                            caseCostingEnabled: checked,
                          } as Partial<FeatureFlagData>)
                          toast.success(
                            checked
                              ? "Case Costing enabled"
                              : "Case Costing disabled"
                          )
                        }}
                      />
                    </div>

                    {/* Surgeon Scorecard - visual from v0 but controlled by existing hook */}
                    <div className="flex items-center justify-between rounded-lg border p-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 dark:from-blue-950/20 dark:to-indigo-950/20 border-blue-200 dark:border-blue-800">
                      <div className="flex items-start gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/30">
                          <UserCog className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                        </div>
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Label className="text-base font-medium">
                              Surgeon Scorecard
                            </Label>
                            <Badge
                              variant="outline"
                              className="text-xs bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-700"
                            >
                              Paid Add-On
                            </Badge>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            Compare surgeon performance, supply utilization, and
                            cost efficiency with detailed scorecards.
                          </p>
                        </div>
                      </div>
                      {/* Note: surgeonScorecardEnabled is not on FeatureFlagData yet;
                          re-use caseCostingEnabled toggle UX pattern for visual match */}
                    </div>
                  </div>
                </>
              ) : null}
            </CardContent>
          </Card>

          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle>Note</AlertTitle>
            <AlertDescription>
              Changes to feature settings take effect immediately. Disabled
              features will be hidden from the navigation menu but data will be
              preserved.
            </AlertDescription>
          </Alert>
        </TabsContent>
      </Tabs>
    </div>
  )
}
