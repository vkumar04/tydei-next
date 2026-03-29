"use client"

import { useState, useEffect } from "react"
import { FormDialog } from "@/components/shared/forms/form-dialog"
import { Field } from "@/components/shared/forms/field"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface Schedule {
  id: string
  reportType: string
  frequency: string
  dayOfWeek?: number | null
  dayOfMonth?: number | null
  emailRecipients: string[]
  isActive: boolean
}

interface ScheduleFormDialogProps {
  schedule?: Schedule
  open: boolean
  onOpenChange: (open: boolean) => void
  onSubmit: (data: {
    reportType: string
    frequency: string
    dayOfWeek?: number
    dayOfMonth?: number
    emailRecipients: string[]
  }) => Promise<void>
  isSubmitting: boolean
}

const reportTypes = [
  { value: "contract_performance", label: "Contract Performance" },
  { value: "rebate_summary", label: "Rebate Summary" },
  { value: "spend_analysis", label: "Spend Analysis" },
  { value: "market_share", label: "Market Share" },
  { value: "case_costing", label: "Case Costing" },
]

const frequencies = [
  { value: "daily", label: "Daily" },
  { value: "weekly", label: "Weekly" },
  { value: "monthly", label: "Monthly" },
]

const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]

export function ScheduleFormDialog({ schedule, open, onOpenChange, onSubmit, isSubmitting }: ScheduleFormDialogProps) {
  const [reportType, setReportType] = useState(schedule?.reportType ?? "contract_performance")
  const [frequency, setFrequency] = useState(schedule?.frequency ?? "weekly")
  const [dayOfWeek, setDayOfWeek] = useState(schedule?.dayOfWeek?.toString() ?? "1")
  const [dayOfMonth, setDayOfMonth] = useState(schedule?.dayOfMonth?.toString() ?? "1")
  const [recipients, setRecipients] = useState(schedule?.emailRecipients.join(", ") ?? "")

  useEffect(() => {
    if (schedule) {
      setReportType(schedule.reportType)
      setFrequency(schedule.frequency)
      setDayOfWeek(schedule.dayOfWeek?.toString() ?? "1")
      setDayOfMonth(schedule.dayOfMonth?.toString() ?? "1")
      setRecipients(schedule.emailRecipients.join(", "))
    }
  }, [schedule])

  const handleSubmit = async () => {
    await onSubmit({
      reportType,
      frequency,
      dayOfWeek: frequency === "weekly" ? parseInt(dayOfWeek) : undefined,
      dayOfMonth: frequency === "monthly" ? parseInt(dayOfMonth) : undefined,
      emailRecipients: recipients.split(",").map((e) => e.trim()).filter(Boolean),
    })
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={schedule ? "Edit Schedule" : "New Report Schedule"}
      onSubmit={handleSubmit}
      isSubmitting={isSubmitting}
    >
      <Field label="Report Type">
        <Select value={reportType} onValueChange={setReportType}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {reportTypes.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      <Field label="Frequency">
        <Select value={frequency} onValueChange={setFrequency}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {frequencies.map((f) => <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
      {frequency === "weekly" && (
        <Field label="Day of Week">
          <Select value={dayOfWeek} onValueChange={setDayOfWeek}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {weekdays.map((d, i) => <SelectItem key={i} value={i.toString()}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
      )}
      {frequency === "monthly" && (
        <Field label="Day of Month">
          <Input type="number" min={1} max={28} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
        </Field>
      )}
      <Field label="Email Recipients" required>
        <Input
          value={recipients}
          onChange={(e) => setRecipients(e.target.value)}
          placeholder="user@example.com, another@example.com"
        />
      </Field>
    </FormDialog>
  )
}
