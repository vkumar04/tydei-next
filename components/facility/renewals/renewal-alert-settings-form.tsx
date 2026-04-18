"use client"

/**
 * Per-user renewal alert settings form.
 *
 * Reads current settings via `getRenewalAlertSettings` and persists via
 * `saveRenewalAlertSettings`. Delivery is deferred per spec §7 — the
 * banner at the top makes that explicit.
 *
 * The server-side shape (see lib/actions/renewals/alert-settings.ts) is:
 *   renewalReminderDaysBefore: number[]  (max 5 positive ints, no dupes)
 *   expirationAlertDays:       number    (1..365)
 *   includeUnderperformingContracts: boolean
 *   includeOverperformingContracts:  boolean
 *   notifyChannels: ("email" | "in_app" | "slack")[]  (non-empty, deduped)
 *
 * The form maps checkboxes for three canonical reminder buckets (180/90/30)
 * plus freeform addition, a numeric input for `expirationAlertDays`, two
 * perf-filter toggles, and three channel toggles.
 */

import { useMemo, useState, useEffect } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
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
  getRenewalAlertSettings,
  saveRenewalAlertSettings,
  type RenewalAlertSettings,
} from "@/lib/actions/renewals/alert-settings"

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

const settingsQueryKey = ["renewals", "alert-settings"] as const

export function RenewalAlertSettingsForm() {
  const qc = useQueryClient()

  const { data, isLoading, isError } = useQuery({
    queryKey: settingsQueryKey,
    queryFn: getRenewalAlertSettings,
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
    }) => saveRenewalAlertSettings(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: settingsQueryKey })
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

  if (isLoading || !form) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-md border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
        Failed to load alert settings.
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Alert delivery is in development</AlertTitle>
        <AlertDescription>
          These settings will apply once the scheduled delivery job goes live.
          Configuring them now lets us reach you as soon as it ships.
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
        <Label htmlFor="expiration-alert-days">
          Urgent expiration alert (days)
        </Label>
        <Input
          id="expiration-alert-days"
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
                    expirationAlertDays: Number.isFinite(parsed) ? parsed : 0,
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
            <Label htmlFor="include-under">Under-performing contracts</Label>
            <p className="text-xs text-muted-foreground">
              Include contracts tracking below their commitment.
            </p>
          </div>
          <Switch
            id="include-under"
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
            <Label htmlFor="include-over">Over-performing contracts</Label>
            <p className="text-xs text-muted-foreground">
              Surface contracts exceeding their commitment for upsell prep.
            </p>
          </div>
          <Switch
            id="include-over"
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
  )
}
