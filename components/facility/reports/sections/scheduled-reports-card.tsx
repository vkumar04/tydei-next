"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { FileText, Mail, Plus, Trash2 } from "lucide-react"
import type { ScheduleRecord } from "./types"

/* ─── Props ──────────────────────────────────────────────────── */

export interface ScheduledReportsCardProps {
  schedules: ScheduleRecord[] | undefined
  onAddClick: () => void
  onToggle: (id: string) => void
  onDelete: (id: string) => void
}

/* ─── Constants ──────────────────────────────────────────────── */

const REPORT_TYPE_LABELS: Record<string, string> = {
  contract_performance: "Contract Performance",
  rebate_summary: "Rebate Summary",
  spend_analysis: "Spend Analysis",
  market_share: "Market Share",
  case_costing: "Case Costing",
}

const DEMO_SCHEDULES = [
  {
    id: "demo-1",
    name: "Weekly Rebate Summary",
    frequency: "weekly",
    nextRun: "Mar 31, 2026",
    recipients: 3,
  },
  {
    id: "demo-2",
    name: "Monthly Usage Report",
    frequency: "monthly",
    nextRun: "Apr 01, 2026",
    recipients: 5,
  },
  {
    id: "demo-3",
    name: "Quarterly Calculation Audit",
    frequency: "quarterly",
    nextRun: "Apr 01, 2026",
    recipients: 2,
  },
]

/* ─── Component ──────────────────────────────────────────────── */

export function ScheduledReportsCard({
  schedules,
  onAddClick,
  onToggle,
  onDelete,
}: ScheduledReportsCardProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              Scheduled Reports
            </CardTitle>
            <CardDescription>
              Automated report delivery to facility contacts
            </CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={onAddClick}>
            <Plus className="mr-2 h-4 w-4" />
            Add Schedule
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {schedules && schedules.length > 0 ? (
            schedules.map((schedule) => (
              <div
                key={schedule.id}
                className="flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex items-center gap-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">
                      {REPORT_TYPE_LABELS[schedule.reportType] ?? schedule.reportType}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {schedule.frequency.charAt(0).toUpperCase() +
                        schedule.frequency.slice(1)}{" "}
                      &bull; {schedule.emailRecipients.length} recipient
                      {schedule.emailRecipients.length !== 1 ? "s" : ""}
                      {schedule.lastSentAt && (
                        <>
                          {" "}
                          &bull; Last sent:{" "}
                          {new Date(schedule.lastSentAt).toLocaleDateString()}
                        </>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <Switch
                    checked={schedule.isActive}
                    onCheckedChange={() => onToggle(schedule.id)}
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => onDelete(schedule.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          ) : (
            <>
              {/* Fallback static schedules when no DB schedules exist */}
              {DEMO_SCHEDULES.map((schedule) => (
                <div
                  key={schedule.id}
                  className="flex items-center justify-between rounded-lg border p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
                      <FileText className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium">{schedule.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {schedule.frequency.charAt(0).toUpperCase() +
                          schedule.frequency.slice(1)}{" "}
                        &bull; Next run: {schedule.nextRun} &bull;{" "}
                        {schedule.recipients} recipients
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <Switch defaultChecked />
                    <Button variant="ghost" size="sm">
                      Edit
                    </Button>
                  </div>
                </div>
              ))}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
