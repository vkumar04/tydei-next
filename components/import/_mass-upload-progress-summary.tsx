"use client"

import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"

interface MassUploadProgressSummaryProps {
  completedCount: number
  documentCount: number
  overallProgress: number
  errorCount: number
  processingCount: number
}

/** Overall progress row: "N of M processed", percent bar, failed/in-progress badges. */
export function MassUploadProgressSummary({
  completedCount,
  documentCount,
  overallProgress,
  errorCount,
  processingCount,
}: MassUploadProgressSummaryProps) {
  return (
    <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg">
      <div className="flex-1 space-y-2">
        <div className="flex items-center justify-between text-sm">
          <span>
            {completedCount} of {documentCount} processed
          </span>
          <span className="text-muted-foreground">{overallProgress}%</span>
        </div>
        <Progress value={overallProgress} />
      </div>
      <div className="flex gap-2">
        {errorCount > 0 && (
          <Badge variant="destructive">{errorCount} failed</Badge>
        )}
        {processingCount > 0 && (
          <Badge variant="secondary">
            {processingCount} in progress
          </Badge>
        )}
      </div>
    </div>
  )
}
