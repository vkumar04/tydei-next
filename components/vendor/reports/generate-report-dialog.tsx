"use client"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FileBarChart, Loader2 } from "lucide-react"
import type { ReportType } from "./reports-types"

export interface GenerateReportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  reportType: ReportType | null
  isGenerating: boolean
  progress: number
  reportPeriod: string
  onReportPeriodChange: (period: string) => void
  selectedFacility: string
  onSelectedFacilityChange: (facility: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function GenerateReportDialog({
  open,
  onOpenChange,
  reportType,
  isGenerating,
  progress,
  reportPeriod,
  onReportPeriodChange,
  selectedFacility,
  onSelectedFacilityChange,
  onConfirm,
  onCancel,
}: GenerateReportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reportType && <reportType.icon className="h-5 w-5 text-primary" />}
            Generate {reportType?.name}
          </DialogTitle>
          <DialogDescription>{reportType?.description}</DialogDescription>
        </DialogHeader>

        {isGenerating ? (
          <div className="py-6 space-y-4">
            <div className="flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Generating report...</span>
                <span>{Math.min(100, Math.round(progress))}%</span>
              </div>
              <Progress value={Math.min(100, progress)} />
            </div>
            <p className="text-sm text-muted-foreground text-center">
              This may take a few moments depending on the data size.
            </p>
          </div>
        ) : (
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>Report Period</Label>
              <Select value={reportPeriod} onValueChange={onReportPeriodChange}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current Period</SelectItem>
                  <SelectItem value="last_month">Last Month</SelectItem>
                  <SelectItem value="last_quarter">Last Quarter</SelectItem>
                  <SelectItem value="ytd">Year to Date</SelectItem>
                  <SelectItem value="last_year">Last Year</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Facility</Label>
              <Select
                value={selectedFacility}
                onValueChange={onSelectedFacilityChange}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Facilities</SelectItem>
                  <SelectItem value="firsthealth">
                    FirstHealth Regional
                  </SelectItem>
                  <SelectItem value="memorial">Memorial Hospital</SelectItem>
                  <SelectItem value="clearwater">Clearwater Medical</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="rounded-lg border p-3 bg-muted/30">
              <div className="text-sm font-medium mb-1">Report Details</div>
              <div className="text-sm text-muted-foreground space-y-1">
                <div className="flex justify-between">
                  <span>Type:</span>
                  <span>{reportType?.name}</span>
                </div>
                <div className="flex justify-between">
                  <span>Frequency:</span>
                  <span>{reportType?.frequency}</span>
                </div>
                <div className="flex justify-between">
                  <span>Format:</span>
                  <span>PDF</span>
                </div>
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          {!isGenerating && (
            <>
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={(e) => {
                  e.preventDefault()
                  onConfirm()
                }}
              >
                <FileBarChart className="h-4 w-4 mr-2" />
                Generate Report
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
