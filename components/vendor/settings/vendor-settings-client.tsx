"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Skeleton } from "@/components/ui/skeleton"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Textarea } from "@/components/ui/textarea"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  User,
  Mail,
  Bell,
  Building2,
  Link2,
  Key,
  Eye,
  EyeOff,
  Pencil,
  TrendingUp,
  Bot,
  FileText,
  Sparkles,
  Users,
  CheckCircle2,
  Send,
  Clock,
  X,
  Check,
} from "lucide-react"
import { VendorProfileForm } from "@/components/vendor/settings/vendor-profile-form"
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
import { useCredits, useUsageHistory } from "@/hooks/use-ai-credits"
import { AI_CREDIT_COSTS } from "@/lib/ai/config"
import { toast } from "sonner"

interface VendorSettingsClientProps {
  vendorId: string
  vendorName: string
  organizationId: string
}

const AI_ACTION_LABELS: Record<string, string> = {
  document_extraction_per_page: "Document Extraction",
  contract_classification: "Contract Classification",
  full_contract_analysis: "Full Contract Analysis",
  ai_chat_question: "AI Chat Question",
  ai_contract_description: "Contract Description",
  ai_recommendation: "AI Recommendation",
  rebate_calculation: "Rebate Calculation",
  contract_comparison: "Contract Comparison",
  market_share_analysis: "Market Share Analysis",
  report_generation: "Report Generation",
  supply_matching: "Supply Matching",
}

export function VendorSettingsClient({
  vendorId,
  vendorName,
  organizationId,
}: VendorSettingsClientProps) {
  const [activeTab, setActiveTab] = useState("profile")
  const [showPassword, setShowPassword] = useState(false)
  const [inviteFacilityDialogOpen, setInviteFacilityDialogOpen] = useState(false)
  const [newInviteFacilityName, setNewInviteFacilityName] = useState("")
  const [newInviteMessage, setNewInviteMessage] = useState("")

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
  const acceptConn = useAcceptConnection(vendorId)
  const rejectConn = useRejectConnection(vendorId)
  const removeConn = useRemoveConnection(vendorId)
  const creditsQuery = useCredits(vendorId, "vendor")
  const usageQuery = useUsageHistory(creditsQuery.data?.id)

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-muted-foreground">
          Manage your account and organization settings
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="profile" className="gap-2">
            <User className="h-4 w-4 hidden sm:inline" />
            Profile
          </TabsTrigger>
          <TabsTrigger value="notifications" className="gap-2">
            <Bell className="h-4 w-4 hidden sm:inline" />
            Notifications
          </TabsTrigger>
          <TabsTrigger value="organization" className="gap-2">
            <Building2 className="h-4 w-4 hidden sm:inline" />
            Organization
          </TabsTrigger>
          <TabsTrigger value="connections" className="gap-2">
            <Link2 className="h-4 w-4 hidden sm:inline" />
            Connections
          </TabsTrigger>
          <TabsTrigger value="billing" className="gap-2">
            <FileText className="h-4 w-4 hidden sm:inline" />
            Billing
          </TabsTrigger>
          <TabsTrigger value="ai-credits" className="gap-2">
            <Sparkles className="h-4 w-4 hidden sm:inline" />
            AI Credits
          </TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Account</CardTitle>
              <CardDescription>Manage your account information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Profile Info */}
              {profile.isLoading ? (
                <Skeleton className="h-20 w-full rounded-xl" />
              ) : profile.data ? (
                <div>
                  <h3 className="text-lg font-medium mb-4">Profile</h3>
                  <div className="flex items-start gap-6">
                    <Avatar className="h-20 w-20">
                      <AvatarFallback className="text-lg">
                        {profile.data.contactName
                          ? profile.data.contactName.split(" ").map(n => n[0]).join("").slice(0, 2).toUpperCase()
                          : profile.data.name.slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex-1 space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label htmlFor="firstName">First Name</Label>
                          <Input id="firstName" defaultValue={profile.data.contactName?.split(" ")[0] || ""} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="lastName">Last Name</Label>
                          <Input id="lastName" defaultValue={profile.data.contactName?.split(" ").slice(1).join(" ") || ""} />
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

              {/* Email */}
              <div>
                <h3 className="text-lg font-medium mb-4">Email Address</h3>
                <div className="flex items-center justify-between p-3 rounded-lg border">
                  <div className="flex items-center gap-3">
                    <Mail className="h-4 w-4 text-muted-foreground" />
                    <span>{profile.data?.contactEmail || "contact@vendor.com"}</span>
                    <Badge variant="secondary" className="text-xs">Primary</Badge>
                  </div>
                </div>
              </div>

              <Separator />

              {/* Security */}
              <div>
                <h3 className="text-lg font-medium mb-4">Security</h3>
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
            </CardContent>
          </Card>
        </TabsContent>

        {/* Notifications Tab */}
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
                <div className="space-y-4">
                  <h3 className="font-medium">Email Notifications</h3>

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Contract Submission Updates</p>
                      <p className="text-sm text-muted-foreground">
                        Get notified when contracts are approved or need revision
                      </p>
                    </div>
                    <Switch
                      checked={prefs.data.expiringContracts as boolean}
                      onCheckedChange={(v) => updatePrefs.mutate({ ...prefs.data!, expiringContracts: v })}
                    />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Purchase Order Alerts</p>
                      <p className="text-sm text-muted-foreground">
                        Notifications for new POs and status changes
                      </p>
                    </div>
                    <Switch
                      checked={prefs.data.pricingErrors as boolean}
                      onCheckedChange={(v) => updatePrefs.mutate({ ...prefs.data!, pricingErrors: v })}
                    />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Rebate Milestones</p>
                      <p className="text-sm text-muted-foreground">
                        Alerts when facilities approach rebate tiers
                      </p>
                    </div>
                    <Switch
                      checked={prefs.data.tierThresholds as boolean}
                      onCheckedChange={(v) => updatePrefs.mutate({ ...prefs.data!, tierThresholds: v })}
                    />
                  </div>
                  <Separator />

                  <div className="flex items-center justify-between py-3">
                    <div>
                      <p className="font-medium">Weekly Performance Summary</p>
                      <p className="text-sm text-muted-foreground">
                        Weekly digest of your contract performance
                      </p>
                    </div>
                    <Switch
                      checked={prefs.data.compliance as boolean}
                      onCheckedChange={(v) => updatePrefs.mutate({ ...prefs.data!, compliance: v })}
                    />
                  </div>
                </div>
              ) : (
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
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Organization Tab */}
        <TabsContent value="organization" className="space-y-6">
          {profile.isLoading ? (
            <Skeleton className="h-[400px] rounded-xl" />
          ) : profile.data ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle>Organization Details</CardTitle>
                  <CardDescription>Manage your company information</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Company Name</Label>
                      <Input defaultValue={profile.data.name} />
                    </div>
                    <div className="space-y-2">
                      <Label>Primary Contact Email</Label>
                      <Input defaultValue={profile.data.contactEmail ?? ""} />
                    </div>
                    <div className="space-y-2">
                      <Label>Phone Number</Label>
                      <Input defaultValue={profile.data.contactPhone ?? ""} />
                    </div>
                    <div className="space-y-2">
                      <Label>Website</Label>
                      <Input defaultValue={profile.data.website ?? ""} />
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

              <VendorProfileForm
                vendor={profile.data}
                onSave={async (data) => {
                  updateProfile.mutate(data)
                }}
                isPending={updateProfile.isPending}
              />
            </>
          ) : null}
        </TabsContent>

        {/* Connections Tab */}
        <TabsContent value="connections" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Facility Connections</CardTitle>
                  <CardDescription>Manage connections with healthcare facilities</CardDescription>
                </div>
                <Dialog open={inviteFacilityDialogOpen} onOpenChange={setInviteFacilityDialogOpen}>
                  <DialogTrigger asChild>
                    <Button>
                      <Send className="mr-2 h-4 w-4" />
                      Invite Facility
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Invite Facility to Connect</DialogTitle>
                      <DialogDescription>
                        Send a connection invite to a healthcare facility. They will be able to receive your pricing and manage contracts.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4 py-4">
                      <div className="space-y-2">
                        <Label htmlFor="facility-name">Facility Name</Label>
                        <Input
                          id="facility-name"
                          placeholder="e.g., Memorial Hospital, St. Mary's Medical Center"
                          value={newInviteFacilityName}
                          onChange={(e) => setNewInviteFacilityName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="invite-message">Message (Optional)</Label>
                        <Textarea
                          id="invite-message"
                          placeholder="Add a personal message to the invite..."
                          value={newInviteMessage}
                          onChange={(e) => setNewInviteMessage(e.target.value)}
                        />
                      </div>
                    </div>
                    <DialogFooter>
                      <Button variant="outline" onClick={() => setInviteFacilityDialogOpen(false)}>
                        Cancel
                      </Button>
                      <Button
                        onClick={() => {
                          if (newInviteFacilityName.trim()) {
                            sendInvite.mutate({
                              fromType: "vendor",
                              fromId: vendorId,
                              fromName: vendorName,
                              toEmail: `admin@${newInviteFacilityName.trim().toLowerCase().replace(/\s/g, "")}.com`,
                              toName: newInviteFacilityName.trim(),
                              message: newInviteMessage || undefined,
                            })
                            setNewInviteFacilityName("")
                            setNewInviteMessage("")
                            setInviteFacilityDialogOpen(false)
                            toast.success(`Connection invite sent to ${newInviteFacilityName}`)
                          }
                        }}
                        disabled={!newInviteFacilityName.trim()}
                      >
                        <Send className="mr-2 h-4 w-4" />
                        Send Invite
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              {connections.isLoading ? (
                <Skeleton className="h-[300px] rounded-xl" />
              ) : (
                <>
                  {/* Connection Stats */}
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="h-5 w-5 text-green-500" />
                        <span className="font-medium">Active</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold">
                        {connections.data?.filter(c => c.status === "accepted").length ?? 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Connected facilities</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center gap-2">
                        <Clock className="h-5 w-5 text-amber-500" />
                        <span className="font-medium">Pending</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold">
                        {connections.data?.filter(c => c.status === "pending" && c.inviteType === "facility_to_vendor").length ?? 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Awaiting your response</p>
                    </div>
                    <div className="rounded-lg border p-4">
                      <div className="flex items-center gap-2">
                        <Send className="h-5 w-5 text-blue-500" />
                        <span className="font-medium">Sent</span>
                      </div>
                      <p className="mt-2 text-2xl font-bold">
                        {connections.data?.filter(c => c.status === "pending" && c.inviteType === "vendor_to_facility").length ?? 0}
                      </p>
                      <p className="text-sm text-muted-foreground">Awaiting facility response</p>
                    </div>
                  </div>

                  <Separator />

                  {/* Pending Invites Received */}
                  {(connections.data?.filter(c => c.status === "pending" && c.inviteType === "facility_to_vendor").length ?? 0) > 0 && (
                    <div className="space-y-4">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Clock className="h-4 w-4 text-amber-500" />
                        Pending Connection Requests
                      </h3>
                      <div className="space-y-3">
                        {connections.data
                          ?.filter(c => c.status === "pending" && c.inviteType === "facility_to_vendor")
                          .map(connection => (
                            <div key={connection.id} className="flex items-center justify-between rounded-lg border p-4 bg-amber-50 dark:bg-amber-900/10">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-10 w-10">
                                  <AvatarFallback className="bg-amber-100 text-amber-700">
                                    {connection.facilityName.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium">{connection.facilityName}</p>
                                  <p className="text-sm text-muted-foreground">
                                    Invited by {connection.invitedByEmail} &bull; {new Date(connection.invitedAt).toLocaleDateString()}
                                  </p>
                                  {connection.message && (
                                    <p className="text-sm mt-1 italic">&quot;{connection.message}&quot;</p>
                                  )}
                                </div>
                              </div>
                              <div className="flex gap-2">
                                <Button variant="outline" size="sm" onClick={() => rejectConn.mutate(connection.id)}>
                                  <X className="h-4 w-4" />
                                </Button>
                                <Button size="sm" onClick={() => acceptConn.mutate(connection.id)}>
                                  <Check className="mr-1 h-4 w-4" />
                                  Accept
                                </Button>
                              </div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}

                  {/* Active Connections */}
                  <div className="space-y-4">
                    <h3 className="font-semibold flex items-center gap-2">
                      <Link2 className="h-4 w-4 text-green-500" />
                      Active Connections
                    </h3>
                    {(connections.data?.filter(c => c.status === "accepted").length ?? 0) === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <Link2 className="h-12 w-12 mx-auto mb-4 opacity-50" />
                        <p>No active facility connections</p>
                        <p className="text-sm">Invite facilities to connect and share your pricing data</p>
                      </div>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Facility</TableHead>
                            <TableHead>Connected Since</TableHead>
                            <TableHead>Initiated By</TableHead>
                            <TableHead className="text-right">Actions</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {connections.data
                            ?.filter(c => c.status === "accepted")
                            .map(connection => (
                              <TableRow key={connection.id}>
                                <TableCell>
                                  <div className="flex items-center gap-3">
                                    <Avatar className="h-8 w-8">
                                      <AvatarFallback className="bg-green-100 text-green-700">
                                        {connection.facilityName.slice(0, 2).toUpperCase()}
                                      </AvatarFallback>
                                    </Avatar>
                                    <span className="font-medium">{connection.facilityName}</span>
                                  </div>
                                </TableCell>
                                <TableCell>{new Date(connection.respondedAt || connection.invitedAt).toLocaleDateString()}</TableCell>
                                <TableCell>
                                  <Badge variant="outline">
                                    {connection.inviteType === "vendor_to_facility" ? "You" : connection.facilityName}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => removeConn.mutate(connection.id)}
                                  >
                                    Disconnect
                                  </Button>
                                </TableCell>
                              </TableRow>
                            ))}
                        </TableBody>
                      </Table>
                    )}
                  </div>

                  {/* Sent Invites */}
                  {(connections.data?.filter(c => c.status === "pending" && c.inviteType === "vendor_to_facility").length ?? 0) > 0 && (
                    <div className="space-y-4">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Send className="h-4 w-4 text-blue-500" />
                        Sent Invites (Awaiting Response)
                      </h3>
                      <div className="space-y-2">
                        {connections.data
                          ?.filter(c => c.status === "pending" && c.inviteType === "vendor_to_facility")
                          .map(connection => (
                            <div key={connection.id} className="flex items-center justify-between rounded-lg border p-3">
                              <div className="flex items-center gap-3">
                                <Avatar className="h-8 w-8">
                                  <AvatarFallback className="bg-blue-100 text-blue-700">
                                    {connection.facilityName.slice(0, 2).toUpperCase()}
                                  </AvatarFallback>
                                </Avatar>
                                <div>
                                  <p className="font-medium">{connection.facilityName}</p>
                                  <p className="text-sm text-muted-foreground">
                                    Sent {new Date(connection.invitedAt).toLocaleDateString()}
                                  </p>
                                </div>
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => removeConn.mutate(connection.id)}>
                                Cancel
                              </Button>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Billing Tab */}
        <TabsContent value="billing" className="space-y-6">
          {/* Current Plan */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Current Plan</CardTitle>
                  <CardDescription>Manage your subscription and billing</CardDescription>
                </div>
                <Badge className="bg-primary">Enterprise</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div>
                  <p className="font-medium">Enterprise Plan</p>
                  <p className="text-sm text-muted-foreground">Unlimited AI credits</p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-semibold text-primary">Custom Pricing</p>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Next billing date: February 1, 2024</span>
                <Button variant="outline" size="sm">Manage Plan</Button>
              </div>
            </CardContent>
          </Card>

          {/* Payment Method */}
          <Card>
            <CardHeader>
              <CardTitle>Payment Method</CardTitle>
              <CardDescription>Manage your payment information</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between p-4 border rounded-lg">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-16 bg-gradient-to-r from-blue-600 to-blue-400 rounded flex items-center justify-center text-white text-xs font-bold">
                    VISA
                  </div>
                  <div>
                    <p className="font-medium">Visa ending in 4242</p>
                    <p className="text-sm text-muted-foreground">Expires 12/2025</p>
                  </div>
                </div>
                <Button variant="ghost" size="sm">
                  <Pencil className="h-4 w-4" />
                </Button>
              </div>
              <Button variant="outline" className="w-full">Add Payment Method</Button>
            </CardContent>
          </Card>

          {/* Billing History */}
          <Card>
            <CardHeader>
              <CardTitle>Billing History</CardTitle>
              <CardDescription>View and download past invoices</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell>Jan 1, 2024</TableCell>
                    <TableCell>Enterprise Plan - Monthly</TableCell>
                    <TableCell>$2,499.00</TableCell>
                    <TableCell><Badge variant="outline" className="text-green-600 border-green-600">Paid</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm">Download</Button></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Dec 1, 2023</TableCell>
                    <TableCell>Enterprise Plan - Monthly</TableCell>
                    <TableCell>$2,499.00</TableCell>
                    <TableCell><Badge variant="outline" className="text-green-600 border-green-600">Paid</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm">Download</Button></TableCell>
                  </TableRow>
                  <TableRow>
                    <TableCell>Nov 1, 2023</TableCell>
                    <TableCell>Enterprise Plan - Monthly</TableCell>
                    <TableCell>$2,499.00</TableCell>
                    <TableCell><Badge variant="outline" className="text-green-600 border-green-600">Paid</Badge></TableCell>
                    <TableCell><Button variant="ghost" size="sm">Download</Button></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        {/* AI Credits Tab */}
        <TabsContent value="ai-credits" className="space-y-6">
          {/* Credit Overview */}
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Credits Used</CardDescription>
                <CardTitle className="text-3xl">
                  {creditsQuery.data ? creditsQuery.data.usedCredits.toLocaleString() : "0"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                {creditsQuery.data && (
                  <div className="space-y-2">
                    <Progress
                      value={creditsQuery.data.monthlyCredits > 0
                        ? Math.round((creditsQuery.data.usedCredits / (creditsQuery.data.monthlyCredits + creditsQuery.data.rolloverCredits)) * 100)
                        : 0}
                      className="h-2"
                    />
                    <p className="text-xs text-muted-foreground">
                      {creditsQuery.data.monthlyCredits > 0
                        ? `${Math.round((creditsQuery.data.usedCredits / (creditsQuery.data.monthlyCredits + creditsQuery.data.rolloverCredits)) * 100)}% of ${(creditsQuery.data.monthlyCredits + creditsQuery.data.rolloverCredits).toLocaleString()} total credits`
                        : "No credit limit configured"}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Remaining Credits</CardDescription>
                <CardTitle className="text-3xl text-green-600">
                  {creditsQuery.data ? creditsQuery.data.remaining.toLocaleString() : "Unlimited"}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xs text-muted-foreground">
                  {creditsQuery.data?.rolloverCredits
                    ? `Includes ${creditsQuery.data.rolloverCredits.toLocaleString()} rollover credits`
                    : "Resets at end of billing period"}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Current Plan</CardDescription>
                <CardTitle className="text-xl flex items-center gap-2">
                  Enterprise
                  <Badge variant="secondary">Unlimited/mo</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                <Button variant="outline" size="sm" className="w-full">
                  <TrendingUp className="h-4 w-4 mr-2" />
                  Upgrade Plan
                </Button>
              </CardContent>
            </Card>
          </div>

          {/* Usage Breakdown */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5" />
                Usage by Feature
              </CardTitle>
              <CardDescription>See which AI features are consuming the most credits</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-center">Credits/Use</TableHead>
                    <TableHead className="text-right">Total Credits</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {Object.entries(AI_CREDIT_COSTS).map(([action, cost]) => (
                    <TableRow key={action}>
                      <TableCell className="font-medium">{AI_ACTION_LABELS[action] ?? action}</TableCell>
                      <TableCell className="text-center text-muted-foreground">{cost}</TableCell>
                      <TableCell className="text-right">-</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          {/* Recent Activity */}
          {usageQuery.data && usageQuery.data.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  Recent AI Activity
                </CardTitle>
                <CardDescription>Last 10 AI actions in your organization</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {usageQuery.data.slice(0, 10).map((record) => (
                    <div key={record.id} className="flex items-center justify-between py-2 border-b last:border-0">
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
                          <Sparkles className="h-4 w-4 text-primary" />
                        </div>
                        <div>
                          <p className="text-sm font-medium">{record.description}</p>
                          <p className="text-xs text-muted-foreground">
                            {record.userName} - {new Date(record.createdAt).toLocaleString()}
                          </p>
                        </div>
                      </div>
                      <Badge variant="outline">{record.creditsUsed} credits</Badge>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Credit Costs Reference */}
          <Card>
            <CardHeader>
              <CardTitle>Credit Costs Reference</CardTitle>
              <CardDescription>How many credits each AI feature uses</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {Object.entries(AI_CREDIT_COSTS).map(([action, cost]) => (
                  <div key={action} className="flex items-center justify-between p-3 rounded-lg border">
                    <span className="text-sm">{AI_ACTION_LABELS[action] ?? action}</span>
                    <Badge variant="secondary">{cost} credits</Badge>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
