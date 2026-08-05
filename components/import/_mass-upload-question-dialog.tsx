"use client"

import { HelpCircleIcon, ChevronRightIcon } from "lucide-react"
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { QueuedDocument } from "./_mass-upload-types"

interface MassUploadQuestionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  doc: QueuedDocument | null
  answers: Record<string, string>
  onAnswersChange: React.Dispatch<React.SetStateAction<Record<string, string>>>
  onSkip: () => void
  onSubmit: () => void
}

/** Per-document Question Dialog — fully props-driven; parent owns all state. */
export function MassUploadQuestionDialog({
  open,
  onOpenChange,
  doc,
  answers,
  onAnswersChange,
  onSkip,
  onSubmit,
}: MassUploadQuestionDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <HelpCircleIcon className="h-5 w-5 text-amber-500" />
            Additional Information Needed
          </DialogTitle>
          <DialogDescription>
            {doc && (
              <>
                Please answer these questions about:{" "}
                <strong>{doc.file.name}</strong>
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        {doc?.questions && (
          <div className="space-y-4 py-4">
            {doc.questions.map((q) => (
              <div key={q.id} className="space-y-2">
                <Label className="flex items-center gap-1">
                  {q.question}
                  {q.required && <span className="text-destructive">*</span>}
                </Label>

                {q.type === "text" && (
                  <Input
                    value={answers[q.field] || ""}
                    onChange={(e) =>
                      onAnswersChange((prev) => ({
                        ...prev,
                        [q.field]: e.target.value,
                      }))
                    }
                    placeholder={`Enter ${q.field.replace(/_/g, " ")}`}
                  />
                )}

                {q.type === "select" && q.options && (
                  <Select
                    value={answers[q.field] || ""}
                    onValueChange={(value) =>
                      onAnswersChange((prev) => ({ ...prev, [q.field]: value }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select an option" />
                    </SelectTrigger>
                    <SelectContent>
                      {q.options.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {q.type === "date" && (
                  <Input
                    type="date"
                    value={answers[q.field] || ""}
                    onChange={(e) =>
                      onAnswersChange((prev) => ({
                        ...prev,
                        [q.field]: e.target.value,
                      }))
                    }
                  />
                )}
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onSkip}>
            Skip
          </Button>
          <Button onClick={onSubmit}>
            <ChevronRightIcon className="mr-2 h-4 w-4" />
            Continue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
