"use client"

/**
 * Vendor Settings — "Alerts" tab.
 *
 * Vendor-side parity with the facility renewal alert-settings form
 * (`components/facility/renewals/renewal-alert-settings-form.tsx`). A thin
 * parity form is used here rather than reusing the facility form directly,
 * because that form is tightly facility-bound: it imports the facility-scoped
 * action (`getRenewalAlertSettings` / `saveRenewalAlertSettings`) directly and
 * hard-codes a static `["renewals", "alert-settings"]` query key with no seam
 * to swap in the vendor action. This form mirrors its shape/validation exactly
 * but reads/writes through the vendor action
 * (`lib/actions/vendor-renewals/alert-settings.ts`) and keys off the
 * per-user `queryKeys.renewalAlertSettings` factory entries.
 *
 * Server-side shape (see the action) is identical to the facility side:
 *   renewalReminderDaysBefore: number[]  (max 5 positive ints, no dupes)
 *   expirationAlertDays:       number    (1..365)
 *   includeUnderperformingContracts: boolean
 *   includeOverperformingContracts:  boolean
 *   notifyChannels: ("email" | "in_app" | "slack")[]  (non-empty, deduped)
 */

import { useMemo, useState, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useSession } from "@/lib/auth"
import { queryKeys } from "@/lib/query-keys"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Skeleton } from "@/components/ui/skeleton"
import { Info, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  getVendorRenewalAlertSettings,
  saveVendorRenewalAlertSettings,
  type RenewalAlertSettings,
} from "@/lib/actions/vendor-renewals/alert-settings"

type Channel = "email" | "in_app" | "slack"

const REMINDER_BUCKETS = [180, 90, 30] as const
type ReminderBucket = (typeof REMINDER_BUCKETS)[number]

interface FormState {
  reminderBuckets: Record<ReminderBucket, boolean>
  expirationAlertDays: number
  includeUnderperformingContracts: boolean
  includeOverperformingContracts: boolean
  channels: Record<Channel, boolean>
}

function toFormState(settings: RenewalAlertSettings): FormState {
  const remindersSet = new Set(settings.renewalReminderDaysBefore)
  const channelsSet = new Set<Channel>(
    settings.notifyChannels.filter(
      (c): c is Channel => c === "email" || c === "in_app" || c === "slack",
    ),
  )
  return {
    reminderBuckets: {
      180: remindersSet.has(180),
      90: remindersSet.has(90),
      30: remindersSet.has(30),
    },
    expirationAlertDays: settings.expirationAlertDays,
    includeUnderperformingContracts: settings.includeUnderperformingContracts,
    includeOverperformingContracts: settings.includeOverperformingContracts,
    channels: {
      email: channelsSet.has("email"),
      in_app: channelsSet.has("in_app"),
      slack: channelsSet.has("slack"),
    },
  }
}

export function AlertsTab() {
  const qc = useQueryClient()
  const { data: session } = useSession()
  const userId = session?.user?.id

  const { data, isLoading, isError } = useQuery({
    // Per-user key; `enabled` guards until the session resolves so the
    // factory key always has a real userId.
    queryKey: userId
      ? queryKeys.renewalAlertSettings.detail(userId)
      : queryKeys.renewalAlertSettings.base,
    queryFn: getVendorRenewalAlertSettings,
    enabled: Boolean(userId),
  })

  const [form, setForm] = useState<FormState | null>(null)

  useEffect(() => {
    if (data && form === null) {
      setForm(toFormState(data))
    }
  }, [data, form])

  const saveMutation = useMutation({
    mutationFn: (input: {
      renewalReminderDaysBefore: number[]
      expirationAlertDays: number
      includeUnderperformingContracts: boolean
      includeOverperformingContracts: boolean
      notifyChannels: Channel[]
    }) => saveVendorRenewalAlertSettings(input),
    onSuccess: () => {
      // Prefix-invalidate the whole per-user family.
      void qc.invalidateQueries({
        queryKey: queryKeys.renewalAlertSettings.base,
      })
      toast.success("Alert settings saved")
    },
    onError: (err: unknown) => {
      const msg =
        err instanceof Error ? err.message : "Failed to save alert settings"
      toast.error(msg)
    },
  })

  const remindersArray = useMemo((): number[] => {
    if (!form) return []
    return REMINDER_BUCKETS.filter((b) => form.reminderBuckets[b])
  }, [form])

  const channelsArray = useMemo((): Channel[] => {
    if (!form) return []
    const out: Channel[] = []
    if (form.channels.email) out.push("email")
    if (form.channels.in_app) out.push("in_app")
    if (form.channels.slack) out.push("slack")
    return out
  }, [form])

  const canSubmit =
    form !== null &&
    remindersArray.length > 0 &&
    channelsArray.length > 0 &&
    form.expirationAlertDays > 0 &&
    form.expirationAlertDays <= 365 &&
    !saveMutation.isPending

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!form || !canSubmit) return
    saveMutation.mutate({
      renewalReminderDaysBefore: remindersArray,
      expirationAlertDays: form.expirationAlertDays,
      includeUnderperformingContracts: form.includeUnderperformingContracts,
      includeOverperformingContracts: form.includeOverperformingContracts,
      notifyChannels: channelsArray,
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Renewal Alerts</CardTitle>
        <CardDescription>
          Configure when and how you&apos;re reminded about expiring and
          renewing contracts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading || !form ? (
          <div className="space-y-3">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : isError ? (
          <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
            Failed to load alert settings.
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-6">
            <Alert>
              <Info className="h-4 w-4" />
              <AlertTitle>Alert delivery is in development</AlertTitle>
              <AlertDescription>
                These settings will apply once the scheduled delivery job goes
                live. Configuring them now lets us reach you as soon as it
                ships.
              </AlertDescription>
            </Alert>

            <section className="space-y-3">
              <div>
                <h4 className="text-sm font-medium">Renewal reminders</h4>
                <p className="text-xs text-muted-foreground">
                  Pick how far ahead of an expiration we remind you.
                </p>
              </div>
              <div className="flex flex-wrap gap-4">
                {REMINDER_BUCKETS.map((bucket) => (
                  <label
                    key={bucket}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <Checkbox
                      checked={form.reminderBuckets[bucket]}
                      onCheckedChange={(checked) =>
                        setForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                reminderBuckets: {
                                  ...prev.reminderBuckets,
                                  [bucket]: checked === true,
                                },
                              }
                            : prev,
                        )
                      }
                    />
                    <span className="text-sm">{bucket}-day reminder</span>
                  </label>
                ))}
              </div>
              {remindersArray.length === 0 ? (
                <p className="text-xs text-destructive">
                  Select at least one reminder window.
                </p>
              ) : null}
            </section>

            <section className="space-y-2">
              <Label htmlFor="vendor-expiration-alert-days">
                Urgent expiration alert (days)
              </Label>
              <Input
                id="vendor-expiration-alert-days"
                type="number"
                min={1}
                max={365}
                value={form.expirationAlertDays}
                onChange={(e) => {
                  const parsed = Number.parseInt(e.target.value, 10)
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          expirationAlertDays: Number.isFinite(parsed)
                            ? parsed
                            : 0,
                        }
                      : prev,
                  )
                }}
                className="max-w-[160px]"
              />
              <p className="text-xs text-muted-foreground">
                Threshold for the urgent-expiration alert (1–365 days).
              </p>
            </section>

            <section className="space-y-3">
              <h4 className="text-sm font-medium">Performance filters</h4>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="vendor-include-under">
                    Under-performing contracts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Include contracts tracking below their commitment.
                  </p>
                </div>
                <Switch
                  id="vendor-include-under"
                  checked={form.includeUnderperformingContracts}
                  onCheckedChange={(checked) =>
                    setForm((prev) =>
                      prev
                        ? { ...prev, includeUnderperformingContracts: checked }
                        : prev,
                    )
                  }
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label htmlFor="vendor-include-over">
                    Over-performing contracts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Surface contracts exceeding their commitment for upsell
                    prep.
                  </p>
                </div>
                <Switch
                  id="vendor-include-over"
                  checked={form.includeOverperformingContracts}
                  onCheckedChange={(checked) =>
                    setForm((prev) =>
                      prev
                        ? { ...prev, includeOverperformingContracts: checked }
                        : prev,
                    )
                  }
                />
              </div>
            </section>

            <section className="space-y-3">
              <h4 className="text-sm font-medium">Delivery channels</h4>
              <div className="flex flex-wrap gap-4">
                {(["email", "in_app", "slack"] as const).map((channel) => (
                  <label
                    key={channel}
                    className="flex cursor-pointer items-center gap-2"
                  >
                    <Checkbox
                      checked={form.channels[channel]}
                      onCheckedChange={(checked) =>
                        setForm((prev) =>
                          prev
                            ? {
                                ...prev,
                                channels: {
                                  ...prev.channels,
                                  [channel]: checked === true,
                                },
                              }
                            : prev,
                        )
                      }
                    />
                    <span className="text-sm capitalize">
                      {channel === "in_app" ? "In-app" : channel}
                    </span>
                  </label>
                ))}
              </div>
              {channelsArray.length === 0 ? (
                <p className="text-xs text-destructive">
                  Select at least one delivery channel.
                </p>
              ) : null}
            </section>

            <div className="flex justify-end">
              <Button type="submit" disabled={!canSubmit}>
                {saveMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save Settings"
                )}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
