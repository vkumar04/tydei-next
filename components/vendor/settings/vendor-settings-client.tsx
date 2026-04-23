"use client"

import { useState } from "react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import {
  User,
  Bell,
  Building2,
  Link2,
  FileText,
  Sparkles,
  SlidersHorizontal,
  Send,
  CreditCard,
} from "lucide-react"
import {
  useVendorProfile,
  useUpdateVendorProfile,
  useNotificationPreferences,
  useUpdateNotificationPreferences,
} from "@/hooks/use-settings"
import {
  useConnections,
  useSendConnectionInvite,
  useAcceptConnection,
  useRejectConnection,
  useRemoveConnection,
} from "@/hooks/use-connections"
import { useCredits, useUsageHistory } from "@/hooks/use-ai-credits"
import { toast } from "sonner"

import { ProfileTab } from "@/components/vendor/settings/tabs/profile-tab"
import { NotificationsTab } from "@/components/vendor/settings/tabs/notifications-tab"
import { OrganizationTab } from "@/components/vendor/settings/tabs/organization-tab"
import { ConnectionsTab } from "@/components/vendor/settings/tabs/connections-tab"
import { BillingTab } from "@/components/vendor/settings/tabs/billing-tab"
import { AICreditsTab } from "@/components/vendor/settings/tabs/ai-credits-tab"

interface VendorSettingsClientProps {
  vendorId: string
  vendorName: string
  organizationId: string
}

export function VendorSettingsClient({
  vendorId,
  vendorName,
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
  const connections = useConnections(vendorId, "vendor")
  const sendInvite = useSendConnectionInvite(vendorId)
  const acceptConn = useAcceptConnection(vendorId)
  const rejectConn = useRejectConnection(vendorId)
  const removeConn = useRemoveConnection(vendorId)
  const creditsQuery = useCredits(vendorId, "vendor")
  const usageQuery = useUsageHistory(creditsQuery.data?.id)

  const displayName = profile.data?.name ?? vendorName

  const handleSendInvite = () => {
    const name = newInviteFacilityName.trim()
    if (!name) return
    sendInvite.mutate({
      fromType: "vendor",
      fromId: vendorId,
      fromName: vendorName,
      toEmail: `admin@${name.toLowerCase().replace(/\s/g, "")}.com`,
      toName: name,
      message: newInviteMessage || undefined,
    })
    setNewInviteFacilityName("")
    setNewInviteMessage("")
    setInviteFacilityDialogOpen(false)
    toast.success(`Connection invite sent to ${name}`)
  }

  const tabs: Array<{ value: string; label: string; Icon: typeof User }> = [
    { value: "profile", label: "Profile", Icon: User },
    { value: "notifications", label: "Notifications", Icon: Bell },
    { value: "organization", label: "Organization", Icon: Building2 },
    { value: "connections", label: "Connections", Icon: Link2 },
    { value: "billing", label: "Billing", Icon: FileText },
    { value: "ai-credits", label: "AI Credits", Icon: Sparkles },
  ]

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border bg-card p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Vendor workspace
            </div>
            <h1 className="text-balance text-2xl font-semibold leading-tight sm:text-3xl">
              {displayName}
            </h1>
            <p className="text-sm text-muted-foreground">
              Manage profile, organization, billing, connections, and AI credits.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setActiveTab("connections")
                setInviteFacilityDialogOpen(true)
              }}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              Invite facility
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
              <Icon className="hidden h-4 w-4 sm:inline" />
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
          />
        </TabsContent>

        <TabsContent value="notifications" className="space-y-6">
          <NotificationsTab
            prefsData={prefs.data}
            prefsIsLoading={prefs.isLoading}
            onSavePrefs={(p) => updatePrefs.mutate(p)}
          />
        </TabsContent>

        <TabsContent value="organization" className="space-y-6">
          <OrganizationTab
            profileData={profile.data}
            profileIsLoading={profile.isLoading}
            onSaveProfile={(data) => updateProfile.mutate(data)}
            isSavingProfile={updateProfile.isPending}
          />
        </TabsContent>

        <TabsContent value="connections" className="space-y-6">
          <ConnectionsTab
            connectionData={connections.data}
            connectionIsLoading={connections.isLoading}
            inviteFacilityDialogOpen={inviteFacilityDialogOpen}
            onSetInviteFacilityDialogOpen={setInviteFacilityDialogOpen}
            newInviteFacilityName={newInviteFacilityName}
            onSetNewInviteFacilityName={setNewInviteFacilityName}
            newInviteMessage={newInviteMessage}
            onSetNewInviteMessage={setNewInviteMessage}
            onSendInvite={handleSendInvite}
            onAcceptConnection={(id) => acceptConn.mutate(id)}
            onRejectConnection={(id) => rejectConn.mutate(id)}
            onRemoveConnection={(id) => removeConn.mutate(id)}
          />
        </TabsContent>

        <TabsContent value="billing" className="space-y-6">
          <BillingTab />
        </TabsContent>

        <TabsContent value="ai-credits" className="space-y-6">
          <AICreditsTab creditsData={creditsQuery.data} usageData={usageQuery.data} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
