"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { ProfileForm } from "@/components/facility/settings/profile-form"
import { NotificationSettings } from "@/components/facility/settings/notification-settings"
import { TeamTable } from "@/components/shared/settings/team-table"
import { InviteMemberDialog } from "@/components/shared/settings/invite-member-dialog"
import { Skeleton } from "@/components/ui/skeleton"
import {
  User,
  Mail,
  Shield,
  Building2,
  Bell,
  CreditCard,
  Users,
  ToggleLeft,
  UserPlus,
  Settings,
  Truck,
  Plus,
  MoreHorizontal,
  Pencil,
  Key,
  Eye,
  EyeOff,
  ShoppingCart,
  Bot,
  Sparkles,
  Stethoscope,
  UserCog,
  Crown,
  AlertTriangle,
  TrendingUp,
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
  const [showPassword, setShowPassword] = useState(false)

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
      {/* Header */}
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
              <CardDescription>Manage your account information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile Section */}
              {profile.isLoading ? (
                <Skeleton className="h-20 w-full rounded-xl" />
              ) : profile.data ? (
                <div>
                  <h3 className="text-lg font-medium mb-4">Profile</h3>
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
                </div>
              ) : null}

              <Separator />

              {/* Email Addresses */}
              <div>
                <h3 className="text-lg font-medium mb-4">Email addresses</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span>{profile.data?.name ? `${profile.data.name.toLowerCase().replace(/\s/g, ".")}@facility.org` : "user@facility.org"}</span>
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

              {/* Security */}
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
                        onClick={() => setShowPassword(!showPassword)}
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

        {/* ─── Notifications Tab ─────────────────────────────────── */}
        <TabsContent value="notifications" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Notification Preferences</CardTitle>
              <CardDescription>Choose how and when you want to be notified</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
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
                <div className="space-y-4">
                  <h3 className="font-medium">Email Notifications</h3>

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Contract Expiration Alerts</p>
                      <p className="text-sm text-muted-foreground">Get notified when contracts are expiring</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Price Discrepancy Alerts</p>
                      <p className="text-sm text-muted-foreground">When invoiced prices differ from contract prices</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Off-Contract Purchase Alerts</p>
                      <p className="text-sm text-muted-foreground">When purchases are made outside contracts</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Weekly Summary Reports</p>
                      <p className="text-sm text-muted-foreground">Receive weekly performance summaries</p>
                    </div>
                    <Switch defaultChecked />
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Billing Tab ──────────────────────────────────────── */}
        <TabsContent value="billing" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Billing &amp; Membership</CardTitle>
              <CardDescription>Manage your subscription and payment methods</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Current Plan */}
              <div className="p-6 rounded-lg border-2 border-primary/20 bg-primary/5">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Crown className="h-5 w-5 text-primary" />
                      <h3 className="text-lg font-semibold">Enterprise Plan</h3>
                    </div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Unlimited users, advanced analytics, and priority support
                    </p>
                    <div className="flex items-baseline gap-1">
                      <span className="text-3xl font-bold">$2,499</span>
                      <span className="text-muted-foreground">/month</span>
                    </div>
                  </div>
                  <Badge className="bg-primary/10 text-primary hover:bg-primary/10">Active</Badge>
                </div>
                <Separator className="my-4" />
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Next billing date: February 1, 2024</span>
                  <Button variant="outline" size="sm">Manage Plan</Button>
                </div>
              </div>

              {/* Payment Method */}
              <div>
                <h3 className="font-medium mb-4">Payment Method</h3>
                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-16 rounded bg-gradient-to-br from-blue-600 to-blue-800 flex items-center justify-center">
                      <span className="text-white text-xs font-bold">VISA</span>
                    </div>
                    <div>
                      <p className="font-medium">Visa ending in 4242</p>
                      <p className="text-sm text-muted-foreground">Expires 12/2025</p>
                    </div>
                  </div>
                  <Button variant="ghost" size="sm">Update</Button>
                </div>
              </div>

              {/* Add-ons */}
              <div>
                <h3 className="font-medium mb-4">Available Add-ons</h3>
                <div className="space-y-3">
                  <div className="flex items-center justify-between p-4 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                        <TrendingUp className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium">Predictive Forecasting</p>
                        <p className="text-sm text-muted-foreground">
                          AI-powered spend and rebate predictions on all charts and reports
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <p className="font-semibold">+$200/mo</p>
                      </div>
                      <Button variant="outline" size="sm">Add</Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between p-4 rounded-lg border bg-green-50/50 dark:bg-green-950/20 border-green-200 dark:border-green-900">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-teal-500 to-emerald-600 flex items-center justify-center">
                        <Bot className="h-5 w-5 text-white" />
                      </div>
                      <div>
                        <p className="font-medium">AI Contract Analysis</p>
                        <p className="text-sm text-muted-foreground">
                          Automated PDF parsing and contract recommendations
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge className="bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Included</Badge>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Members Tab ──────────────────────────────────────── */}
        <TabsContent value="members" className="space-y-6">
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
              {/* Role Legend */}
              <div className="flex flex-wrap gap-4 mb-6 p-4 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-purple-500" />
                  <span className="text-sm"><strong>Super Admin:</strong> Full system access</span>
                </div>
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-blue-500" />
                  <span className="text-sm"><strong>Admin:</strong> Manage users &amp; settings</span>
                </div>
                <div className="flex items-center gap-2">
                  <User className="h-4 w-4 text-green-500" />
                  <span className="text-sm"><strong>User:</strong> Standard access</span>
                </div>
                <div className="flex items-center gap-2">
                  <Eye className="h-4 w-4 text-gray-500" />
                  <span className="text-sm"><strong>Viewer:</strong> Read-only</span>
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

        {/* ─── Account Tab ──────────────────────────────────────── */}
        <TabsContent value="account" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Organization Settings</CardTitle>
              <CardDescription>Manage your organization details</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="orgName">Organization Name</Label>
                  <Input id="orgName" defaultValue={profile.data?.healthSystemName || "Organization"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="orgType">Organization Type</Label>
                  <Input id="orgType" defaultValue={profile.data?.type || "Health System"} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" defaultValue={profile.data?.address || ""} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="city">City, State, ZIP</Label>
                  <Input id="city" defaultValue={profile.data?.city && profile.data?.state ? `${profile.data.city}, ${profile.data.state}` : ""} />
                </div>
              </div>
              <Button>Save Organization Settings</Button>
            </CardContent>
          </Card>

          {/* Feature Modules */}
          <Card>
            <CardHeader>
              <CardTitle>Feature Modules</CardTitle>
              <CardDescription>Enable or disable optional features</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {flags.data && (
                <>
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Purchase Order Module</p>
                      <p className="text-sm text-muted-foreground">Enable digital PO creation and tracking</p>
                    </div>
                    <Switch
                      checked={flags.data.purchaseOrdersEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({ purchaseOrdersEnabled: checked } as Partial<FeatureFlagData>)
                      }}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">AI Contract Parsing</p>
                      <p className="text-sm text-muted-foreground">Use AI to extract contract terms from PDFs</p>
                    </div>
                    <Switch
                      checked={flags.data.aiAgentEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({ aiAgentEnabled: checked } as Partial<FeatureFlagData>)
                      }}
                    />
                  </div>
                  <Separator />
                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Surgeon Scorecard</p>
                      <p className="text-sm text-muted-foreground">Track surgeon performance and margins</p>
                    </div>
                    <Switch
                      checked={flags.data.caseCostingEnabled}
                      onCheckedChange={(checked) => {
                        updateFlags.mutate({ caseCostingEnabled: checked } as Partial<FeatureFlagData>)
                      }}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Danger Zone */}
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="text-destructive">Danger Zone</CardTitle>
              <CardDescription>Irreversible actions for your account</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/20">
                <div>
                  <p className="font-medium">Export All Data</p>
                  <p className="text-sm text-muted-foreground">Download all your organization data</p>
                </div>
                <Button variant="outline">Export</Button>
              </div>
              <div className="flex items-center justify-between p-4 rounded-lg border border-destructive/20">
                <div>
                  <p className="font-medium text-destructive">Delete Organization</p>
                  <p className="text-sm text-muted-foreground">Permanently delete all data</p>
                </div>
                <Button variant="destructive">Delete</Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Facilities Tab ───────────────────────────────────── */}
        <TabsContent value="facilities" className="space-y-6">
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
              {/* Facility Stats */}
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
                  <p className="mt-2 text-2xl font-bold text-green-600">1</p>
                </div>
                <div className="rounded-lg border p-4">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">Inactive</span>
                  </div>
                  <p className="mt-2 text-2xl font-bold text-muted-foreground">0</p>
                </div>
              </div>

              {/* Facility List */}
              {profile.data && (
                <div className="flex items-center justify-between p-4 rounded-lg border">
                  <div className="flex items-center gap-4">
                    <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                      <Building2 className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{profile.data.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {profile.data.type
                          ? profile.data.type.charAt(0).toUpperCase() + profile.data.type.slice(1)
                          : "Hospital"}
                        {profile.data.city && ` -- ${profile.data.city}, ${profile.data.state}`}
                      </p>
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-800">Active</Badge>
                </div>
              )}
            </CardContent>
          </Card>
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

                    {/* Surgeon Scorecard */}
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
