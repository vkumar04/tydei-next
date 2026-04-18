"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { queryKeys } from "@/lib/query-keys"
import {
  listReportSchedules,
  createReportSchedule,
  updateReportSchedule,
  deleteReportSchedule,
  type ReportSchedule,
  type CreateReportScheduleActionInput,
} from "@/lib/actions/reports/schedule"

/**
 * List + create + edit + delete for ReportSchedule rows.
 *
 * Note: the cron delivery of scheduled reports is not wired. The
 * non-dismissable banner at the top of the dialog makes this
 * clear to the user.
 *
 * Reference: docs/superpowers/specs/2026-04-18-reports-hub-rewrite.md §4.5
 */
export interface ReportsScheduleDialogProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

type SpecReportType = CreateReportScheduleActionInput["reportType"]
type SpecFrequency = CreateReportScheduleActionInput["frequency"]

const REPORT_TYPES: { value: SpecReportType; label: string }[] = [
  { value: "usage", label: "Usage" },
  { value: "capital", label: "Capital" },
  { value: "service", label: "Service" },
  { value: "tie_in", label: "Tie-In" },
  { value: "grouped", label: "Grouped" },
  { value: "pricing_only", label: "Pricing" },
  { value: "discrepancy", label: "Price Discrepancy" },
]

const FREQUENCIES: { value: SpecFrequency; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
]

interface FormState {
  name: string
  reportType: SpecReportType
  frequency: SpecFrequency
  recipients: string[]
  recipientInput: string
  includeCharts: boolean
  includeLineItems: boolean
}

const INITIAL_FORM: FormState = {
  name: "",
  reportType: "usage",
  frequency: "weekly",
  recipients: [],
  recipientInput: "",
  includeCharts: true,
  includeLineItems: false,
}

export function ReportsScheduleDialog({
  facilityId,
  open,
  onOpenChange,
}: ReportsScheduleDialogProps) {
  const qc = useQueryClient()
  const [form, setForm] = useState<FormState>(INITIAL_FORM)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [mode, setMode] = useState<"list" | "form">("list")

  const { data: schedules, isLoading } = useQuery({
    queryKey: queryKeys.reportSchedules.list(facilityId),
    queryFn: () => listReportSchedules(),
    enabled: open,
  })

  const createMut = useMutation({
    mutationFn: (input: CreateReportScheduleActionInput) =>
      createReportSchedule(input),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.reportSchedules.list(facilityId),
      })
      toast.success("Schedule created")
      resetAndReturnToList()
    },
    onError: () => toast.error("Failed to create schedule"),
  })

  const updateMut = useMutation({
    mutationFn: (input: {
      id: string
      patch: CreateReportScheduleActionInput
    }) => updateReportSchedule(input.id, input.patch),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.reportSchedules.list(facilityId),
      })
      toast.success("Schedule updated")
      resetAndReturnToList()
    },
    onError: () => toast.error("Failed to update schedule"),
  })

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteReportSchedule(id),
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: queryKeys.reportSchedules.list(facilityId),
      })
      toast.success("Schedule deleted")
    },
    onError: () => toast.error("Failed to delete schedule"),
  })

  function resetAndReturnToList() {
    setForm(INITIAL_FORM)
    setEditingId(null)
    setMode("list")
  }

  function addRecipient() {
    const email = form.recipientInput.trim()
    if (!email) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error("Invalid email")
      return
    }
    if (form.recipients.includes(email)) return
    setForm((f) => ({
      ...f,
      recipients: [...f.recipients, email],
      recipientInput: "",
    }))
  }

  function removeRecipient(email: string) {
    setForm((f) => ({
      ...f,
      recipients: f.recipients.filter((r) => r !== email),
    }))
  }

  function startEdit(row: ReportSchedule) {
    setEditingId(row.id)
    setMode("form")
    // Best-effort mapping back to spec types. The DB enum collapses
    // multiple spec types down to shared buckets; fall back to "usage".
    const specType: SpecReportType =
      row.reportType === "spend_analysis" ? "discrepancy" : "usage"
    const specFreq: SpecFrequency =
      row.frequency === "daily"
        ? "daily"
        : row.frequency === "weekly"
          ? "weekly"
          : "monthly"
    setForm({
      name: `Schedule ${row.id.slice(0, 6)}`,
      reportType: specType,
      frequency: specFreq,
      recipients: row.emailRecipients,
      recipientInput: "",
      includeCharts: true,
      includeLineItems: false,
    })
  }

  function submit() {
    if (!form.name.trim()) {
      toast.error("Name is required")
      return
    }
    if (form.recipients.length === 0) {
      toast.error("Add at least one recipient")
      return
    }
    const payload: CreateReportScheduleActionInput = {
      name: form.name,
      reportType: form.reportType,
      frequency: form.frequency,
      recipients: form.recipients,
      includeCharts: form.includeCharts,
      includeLineItems: form.includeLineItems,
    }
    if (editingId) {
      updateMut.mutate({ id: editingId, patch: payload })
    } else {
      createMut.mutate(payload)
    }
  }

  const busy = createMut.isPending || updateMut.isPending

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Scheduled Reports</DialogTitle>
          <DialogDescription>
            Configure recurring report delivery. Delivery is deferred — see
            banner below.
          </DialogDescription>
        </DialogHeader>

        <Alert>
          <AlertDescription>
            Scheduled delivery is in development. These settings will apply
            once the scheduled job goes live.
          </AlertDescription>
        </Alert>

        {mode === "list" ? (
          <div className="space-y-3">
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => {
                  resetAndReturnToList()
                  setMode("form")
                }}
              >
                <Plus className="mr-1 h-4 w-4" /> New Schedule
              </Button>
            </div>
            {isLoading ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Loading…
              </p>
            ) : !schedules || schedules.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No scheduled reports yet.
              </p>
            ) : (
              <div className="rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Type</th>
                      <th className="px-3 py-2 text-left font-medium">
                        Frequency
                      </th>
                      <th className="px-3 py-2 text-left font-medium">
                        Recipients
                      </th>
                      <th className="px-3 py-2 text-left font-medium">Active</th>
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {schedules.map((s) => (
                      <tr key={s.id} className="border-t">
                        <td className="px-3 py-2 capitalize">
                          {s.reportType.replace(/_/g, " ")}
                        </td>
                        <td className="px-3 py-2 capitalize">{s.frequency}</td>
                        <td className="px-3 py-2 text-muted-foreground">
                          {s.emailRecipients.slice(0, 2).join(", ")}
                          {s.emailRecipients.length > 2 &&
                            ` +${s.emailRecipients.length - 2}`}
                        </td>
                        <td className="px-3 py-2">
                          <Badge
                            variant={s.isActive ? "default" : "secondary"}
                          >
                            {s.isActive ? "Active" : "Paused"}
                          </Badge>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => startEdit(s)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => deleteMut.mutate(s.id)}
                              disabled={deleteMut.isPending}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <Label htmlFor="sched-name">Name</Label>
              <Input
                id="sched-name"
                value={form.name}
                onChange={(e) =>
                  setForm((f) => ({ ...f, name: e.target.value }))
                }
                placeholder="Weekly usage roll-up"
              />
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <Label>Report Type</Label>
                <Select
                  value={form.reportType}
                  onValueChange={(v: SpecReportType) =>
                    setForm((f) => ({ ...f, reportType: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {REPORT_TYPES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>
                        {r.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Frequency</Label>
                <Select
                  value={form.frequency}
                  onValueChange={(v: SpecFrequency) =>
                    setForm((f) => ({ ...f, frequency: v }))
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FREQUENCIES.map((f) => (
                      <SelectItem key={f.value} value={f.value}>
                        {f.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div>
              <Label>Recipients</Label>
              <div className="flex gap-2">
                <Input
                  value={form.recipientInput}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      recipientInput: e.target.value,
                    }))
                  }
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault()
                      addRecipient()
                    }
                  }}
                  placeholder="recipient@example.com"
                />
                <Button type="button" variant="outline" onClick={addRecipient}>
                  Add
                </Button>
              </div>
              {form.recipients.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {form.recipients.map((r) => (
                    <Badge
                      key={r}
                      variant="secondary"
                      className="cursor-pointer"
                    >
                      {r}
                      <button
                        type="button"
                        onClick={() => removeRecipient(r)}
                        className="ml-1"
                        aria-label={`Remove ${r}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-6">
              <div className="flex items-center gap-2">
                <Switch
                  id="inc-charts"
                  checked={form.includeCharts}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, includeCharts: v }))
                  }
                />
                <Label htmlFor="inc-charts">Include charts</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch
                  id="inc-line-items"
                  checked={form.includeLineItems}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, includeLineItems: v }))
                  }
                />
                <Label htmlFor="inc-line-items">Include line items</Label>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {mode === "form" ? (
            <>
              <Button
                variant="outline"
                onClick={resetAndReturnToList}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy}>
                {editingId ? "Save" : "Create"}
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
