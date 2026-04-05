"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CalendarClock, Trash2 } from "lucide-react"
import type { NewScheduleState } from "./types"

/* ─── Props ──────────────────────────────────────────────────── */

export interface ScheduleReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  newSchedule: NewScheduleState
  onScheduleChange: React.Dispatch<React.SetStateAction<NewScheduleState>>
  onAddRecipient: () => void
  onRemoveRecipient: (email: string) => void
  onCreateSchedule: () => void
}

/* ─── Component ──────────────────────────────────────────────── */

export function ScheduleReportDialog({
  open,
  onOpenChange,
  newSchedule,
  onScheduleChange,
  onAddRecipient,
  onRemoveRecipient,
  onCreateSchedule,
}: ScheduleReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Schedule Report
          </DialogTitle>
          <DialogDescription>
            Set up automated report delivery to your team
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Report Type */}
          <div className="space-y-2">
            <Label>Report Type</Label>
            <Select
              value={newSchedule.reportType}
              onValueChange={(v) =>
                onScheduleChange((prev) => ({
                  ...prev,
                  reportType: v as typeof prev.reportType,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select report type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="contract_performance">Contract Performance</SelectItem>
                <SelectItem value="rebate_summary">Rebate Summary</SelectItem>
                <SelectItem value="spend_analysis">Spend Analysis</SelectItem>
                <SelectItem value="market_share">Market Share</SelectItem>
                <SelectItem value="case_costing">Case Costing</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Frequency */}
          <div className="space-y-2">
            <Label>Frequency</Label>
            <Select
              value={newSchedule.frequency}
              onValueChange={(v) =>
                onScheduleChange((prev) => ({
                  ...prev,
                  frequency: v as typeof prev.frequency,
                }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="Select frequency" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly</SelectItem>
                <SelectItem value="monthly">Monthly</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Recipients */}
          <div className="space-y-2">
            <Label>Recipients</Label>
            <div className="flex gap-2">
              <Input
                type="email"
                placeholder="email@example.com"
                value={newSchedule.recipientInput}
                onChange={(e) =>
                  onScheduleChange((prev) => ({
                    ...prev,
                    recipientInput: e.target.value,
                  }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault()
                    onAddRecipient()
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={onAddRecipient}>
                Add
              </Button>
            </div>
            {newSchedule.recipients.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {newSchedule.recipients.map((email) => (
                  <Badge key={email} variant="secondary" className="gap-1 pr-1">
                    {email}
                    <button
                      type="button"
                      onClick={() => onRemoveRecipient(email)}
                      className="ml-1 rounded-full hover:bg-muted p-0.5"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>

          {/* Options */}
          <div className="space-y-3">
            <Label>Options</Label>
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeCharts"
                checked={newSchedule.includeCharts}
                onCheckedChange={(checked) =>
                  onScheduleChange((prev) => ({
                    ...prev,
                    includeCharts: !!checked,
                  }))
                }
              />
              <Label htmlFor="includeCharts" className="text-sm font-normal cursor-pointer">
                Include charts and visualizations
              </Label>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox
                id="includeLineItems"
                checked={newSchedule.includeLineItems}
                onCheckedChange={(checked) =>
                  onScheduleChange((prev) => ({
                    ...prev,
                    includeLineItems: !!checked,
                  }))
                }
              />
              <Label htmlFor="includeLineItems" className="text-sm font-normal cursor-pointer">
                Include detailed line items
              </Label>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onCreateSchedule}>
            <CalendarClock className="mr-2 h-4 w-4" />
            Create Schedule
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
