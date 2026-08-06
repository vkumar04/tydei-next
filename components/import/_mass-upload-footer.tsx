"use client"

import { CheckCircle2Icon, SparklesIcon, Loader2Icon } from "lucide-react"
import { DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface MassUploadFooterProps {
  isProcessing: boolean
  step: "upload" | "processing" | "review"
  completedCount: number
  pendingCount: number
  documentCount: number
  onCancel: () => void
  onComplete: () => void
  onProcessAll: () => void
}

/** Main dialog footer: Cancel, Complete (review step), and Process All buttons. */
export function MassUploadFooter({
  isProcessing,
  step,
  completedCount,
  pendingCount,
  documentCount,
  onCancel,
  onComplete,
  onProcessAll,
}: MassUploadFooterProps) {
  return (
    <DialogFooter className="flex justify-between sm:justify-between">
      <Button
        variant="outline"
        onClick={onCancel}
        disabled={isProcessing}
      >
        Cancel
      </Button>
      <div className="flex gap-2">
        {step === "review" && completedCount > 0 && (
          <Button onClick={onComplete}>
            <CheckCircle2Icon className="mr-2 h-4 w-4" />
            Complete ({completedCount} documents)
          </Button>
        )}
        {step !== "review" && documentCount > 0 && (
          <Button
            onClick={onProcessAll}
            disabled={isProcessing || pendingCount === 0}
          >
            {isProcessing ? (
              <>
                <Loader2Icon className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <SparklesIcon className="mr-2 h-4 w-4" />
                Process All ({pendingCount})
              </>
            )}
          </Button>
        )}
      </div>
    </DialogFooter>
  )
}
