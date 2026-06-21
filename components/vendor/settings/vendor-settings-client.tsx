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
  FolderTree,
  Boxes,
  BellRing,
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
  useSetConnectionMode,
  useVendorOperatingMode,
  useSetVendorOperatingMode,
} from "@/hooks/use-connections"
import type { ConnectionMode } from "@/lib/generated/prisma/client"
import { useCredits, useUsageHistory } from "@/hooks/use-ai-credits"
import { toast } from "sonner"

import { ProfileTab } from "@/components/vendor/settings/tabs/profile-tab"
import { NotificationsTab } from "@/components/vendor/settings/tabs/notifications-tab"
import { OrganizationTab } from "@/components/vendor/settings/tabs/organization-tab"
import { ConnectionsTab } from "@/components/vendor/settings/tabs/connections-tab"
import { BillingTab } from "@/components/vendor/settings/tabs/billing-tab"
import { AICreditsTab } from "@/components/vendor/settings/tabs/ai-credits-tab"
import { DivisionsTab } from "@/components/vendor/settings/tabs/divisions-tab"
import { CogsTab } from "@/components/vendor/settings/tabs/cogs-tab"
import { AlertsTab } from "@/components/vendor/settings/tabs/alerts-tab"

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
  const setMode = useSetConnectionMode(vendorId)
  const operatingMode = useVendorOperatingMode(vendorId)
  const setOperatingMode = useSetVendorOperatingMode(vendorId)
  const creditsQuery = useCredits(vendorId, "vendor")
  const usageQuery = useUsageHistory(creditsQuery.data?.id)

  const displayName = profile.data?.name ?? vendorName

  // Operating mode (Charles 2026-06-20): the vendor's EXPLICIT vendor-level
  // choice (Vendor.defaultMode) wins when set; otherwise derive it — a vendor
  // uses "facility data" only when it has an ACCEPTED two-way connection,
  // else it operates 1-way and manages its own COGs. So a standalone vendor
  // gets the COGS upload by default AND can now explicitly pick 1-way/2-way.
  const hasTwoWayConnection =
    connections.data?.some(
      (c) => c.status === "accepted" && c.mode === "two_way",
    ) ?? false
  const explicitMode = operatingMode.data ?? null
  const isOneWay = explicitMode
    ? explicitMode === "one_way"
    : !hasTwoWayConnection

  const handleSendInvite = () => {
    const name = newInviteFacilityName.trim()
    if (!name) return
    // 2026-06-09 settings audit: success used to toast unconditionally,
    // hiding server failures (e.g. "Facility not found with that email").
    sendInvite.mutate(
      {
        // Resolved by facility NAME server-side — no fabricated email.
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
    setNewInviteFacilityName("")
    setNewInviteMessage("")
    setInviteFacilityDialogOpen(false)
  }

  const tabs: Array<{ value: string; label: string; Icon: typeof User }> = [
    { value: "profile", label: "Profile", Icon: User },
    { value: "notifications", label: "Notifications", Icon: Bell },
    { value: "organization", label: "Organization", Icon: Building2 },
    { value: "divisions", label: "Divisions", Icon: FolderTree },
    { value: "connections", label: "Connections", Icon: Link2 },
    { value: "cogs", label: "COGS", Icon: Boxes },
    { value: "alerts", label: "Alerts", Icon: BellRing },
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
          {/* Vendor-level operating mode — the standalone-vendor choice
              (Charles 2026-06-20: "the setting for the vendor to choose to load
              its own contracts… or use that facility data"). */}
          <div className="rounded-xl border bg-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <h3 className="text-sm font-semibold">Operating mode</h3>
                <p className="text-sm text-muted-foreground">
                  {isOneWay
                    ? "1-way — you load your own contracts and COGs; facility data is not used."
                    : "2-way — connected to a facility; your contracts flow to them and you use their purchase data."}
                  {explicitMode === null && (
                    <span className="ml-1 italic">
                      (auto, from your connections — pick one to set it
                      explicitly)
                    </span>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <Button
                  variant={isOneWay ? "default" : "outline"}
                  size="sm"
                  disabled={setOperatingMode.isPending}
                  onClick={() =>
                    setOperatingMode.mutate("one_way" as ConnectionMode, {
                      onSuccess: () =>
                        toast.success("Operating in 1-way mode (own contracts + COGs)"),
                      onError: (err) =>
                        toast.error(
                          err instanceof Error ? err.message : "Failed to set mode",
                        ),
                    })
                  }
                >
                  1-way
                </Button>
                <Button
                  variant={!isOneWay ? "default" : "outline"}
                  size="sm"
                  disabled={setOperatingMode.isPending}
                  onClick={() =>
                    setOperatingMode.mutate("two_way" as ConnectionMode, {
                      onSuccess: () =>
                        toast.success("Operating in 2-way mode (facility connection)"),
                      onError: (err) =>
                        toast.error(
                          err instanceof Error ? err.message : "Failed to set mode",
                        ),
                    })
                  }
                >
                  2-way
                </Button>
              </div>
            </div>
          </div>
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
            onSetConnectionMode={(id, mode: ConnectionMode) =>
              setMode.mutate(
                { connectionId: id, mode },
                {
                  onSuccess: () =>
                    toast.success(
                      mode === "two_way"
                        ? "Now sharing contracts with this facility"
                        : "Contracts kept private — using your own COGs",
                    ),
                  onError: (err) =>
                    toast.error(
                      err instanceof Error ? err.message : "Failed to update mode",
                    ),
                },
              )
            }
          />
        </TabsContent>

        <TabsContent value="divisions" className="space-y-6">
          <DivisionsTab vendorId={vendorId} canManage />
        </TabsContent>

        <TabsContent value="cogs" className="space-y-6">
          <CogsTab vendorId={vendorId} isOneWay={isOneWay} />
        </TabsContent>

        <TabsContent value="alerts" className="space-y-6">
          <AlertsTab />
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
