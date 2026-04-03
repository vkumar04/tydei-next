"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import {
  Upload,
  Loader2,
  FileText,
  Cpu,
  GitCompareArrows,
  Check,
  X,
  ArrowRight,
  Plus,
  Minus,
  RefreshCw,
} from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { updateContract } from "@/lib/actions/contracts"
import { toast } from "sonner"
import type { AmendmentChange } from "@/app/api/ai/extract-amendment/route"

interface AmendmentExtractorProps {
  contractId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}

type Stage = "upload" | "extracting" | "review" | "applying" | "error"

const STEPS = [
  { label: "Uploading amendment", icon: Upload, target: 15 },
  { label: "Reading amendment PDF", icon: FileText, target: 50 },
  { label: "Comparing against contract", icon: Cpu, target: 85 },
] as const

export function AmendmentExtractor({
  contractId,
  open,
  onOpenChange,
  onApplied,
}: AmendmentExtractorProps) {
  const [stage, setStage] = useState<Stage>("upload")
  const [progress, setProgress] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [changes, setChanges] = useState<AmendmentChange[]>([])
  const [effectiveDate, setEffectiveDate] = useState<string | null>(null)
  const [error, setError] = useState("")
  const [fileName, setFileName] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTick = useCallback(() => {
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }, [])

  // Smooth progress tick during extraction
  useEffect(() => {
    if (stage !== "extracting") {
      stopTick()
      return
    }
    tickRef.current = setInterval(() => {
      setProgress((p) => {
        const target = STEPS[stepIndex]?.target ?? 90
        if (p >= target) return p
        const remaining = target - p
        const increment = Math.max(0.3, remaining * 0.04)
        return Math.min(target, p + increment)
      })
    }, 500)
    return stopTick
  }, [stage, stepIndex, stopTick])

  async function handleFile(file: File) {
    setStage("extracting")
    setProgress(0)
    setStepIndex(0)
    setFileName(file.name)

    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("contractId", contractId)

      // Step 1: Upload
      setStepIndex(0)
      setProgress(10)

      // Step 2: Reading
      setStepIndex(1)

      const res = await fetch("/api/ai/extract-amendment", {
        method: "POST",
        body: formData,
      })

      // Step 3: Comparing
      setStepIndex(2)
      setProgress(90)

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(
          (body as { error?: string } | null)?.error || "Extraction failed"
        )
      }

      const data = (await res.json()) as {
        changes: AmendmentChange[]
        effectiveDate: string | null
      }
      setProgress(100)
      setChanges(data.changes)
      setEffectiveDate(data.effectiveDate)
      setStage("review")
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Failed to extract amendment. Please try again."
      )
      setStage("error")
    }
  }

  async function handleApply() {
    setStage("applying")
    try {
      // Build the update payload from the extracted changes
      const updatePayload: Record<string, unknown> = {}

      for (const change of changes) {
        if (change.type === "removed") continue

        // Map well-known top-level fields
        switch (change.field) {
          case "effectiveDate":
          case "expirationDate":
            updatePayload[change.field] = change.newValue
            break
          case "totalValue":
          case "annualValue":
            updatePayload[change.field] = parseFloat(change.newValue) || 0
            break
          case "terminationNoticeDays":
            updatePayload[change.field] = parseInt(change.newValue, 10) || 0
            break
          case "autoRenewal":
            updatePayload[change.field] =
              change.newValue.toLowerCase() === "true" ||
              change.newValue.toLowerCase() === "yes"
            break
          case "description":
          case "notes":
          case "gpoAffiliation":
          case "name":
          case "contractNumber":
            updatePayload[change.field] = change.newValue
            break
          default:
            // Term-level changes — logged but not auto-applied to top-level
            break
        }
      }

      if (Object.keys(updatePayload).length > 0) {
        await updateContract(contractId, updatePayload)
      }

      toast.success("Amendment changes applied successfully")
      onApplied()
      onOpenChange(false)
      resetState()
    } catch {
      toast.error("Failed to apply changes")
      setStage("review")
    }
  }

  function resetState() {
    setStage("upload")
    setProgress(0)
    setStepIndex(0)
    setChanges([])
    setEffectiveDate(null)
    setError("")
    setFileName("")
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-5" /> Amendment Extractor
          </DialogTitle>
          <DialogDescription>
            Upload an amendment PDF to extract and compare changes against the
            current contract.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />

        {/* Upload Stage */}
        {stage === "upload" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">
              Upload a contract amendment PDF to identify what changed
            </p>
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" /> Upload Amendment PDF
            </Button>
          </div>
        )}

        {/* Extracting Stage */}
        {stage === "extracting" && (
          <div className="flex flex-col items-center gap-6 py-8">
            {fileName && (
              <p className="text-xs text-muted-foreground truncate max-w-xs">
                {fileName}
              </p>
            )}
            <div className="flex flex-col gap-3 w-72">
              {STEPS.map((step, i) => {
                const StepIcon = step.icon
                const isActive = i === stepIndex
                const isDone = i < stepIndex
                return (
                  <div
                    key={i}
                    className={`flex items-center gap-3 text-sm transition-opacity ${isActive ? "opacity-100" : isDone ? "opacity-50" : "opacity-30"}`}
                  >
                    {isActive ? (
                      <Loader2 className="size-4 animate-spin text-primary shrink-0" />
                    ) : isDone ? (
                      <StepIcon className="size-4 text-emerald-500 shrink-0" />
                    ) : (
                      <StepIcon className="size-4 shrink-0" />
                    )}
                    <span className={isActive ? "font-medium" : ""}>
                      {step.label}
                    </span>
                  </div>
                )
              })}
            </div>
            <Progress value={progress} className="h-2 w-72" />
            <p className="text-xs text-muted-foreground">
              This may take 1-3 minutes for large documents
            </p>
          </div>
        )}

        {/* Review Stage */}
        {stage === "review" && (
          <div className="space-y-4">
            {effectiveDate && (
              <div className="flex items-center gap-2 text-sm">
                <Badge variant="outline">Amendment Effective Date</Badge>
                <span className="font-medium">{effectiveDate}</span>
              </div>
            )}

            {changes.length === 0 ? (
              <div className="flex flex-col items-center gap-4 py-8">
                <p className="text-sm text-muted-foreground">
                  No changes detected in this amendment.
                </p>
                <Button variant="outline" onClick={() => resetState()}>
                  Try Another File
                </Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">
                  {changes.length} change{changes.length !== 1 ? "s" : ""}{" "}
                  detected
                </p>

                <div className="rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-10" />
                        <TableHead>Field</TableHead>
                        <TableHead>Current Value</TableHead>
                        <TableHead className="w-10" />
                        <TableHead>New Value</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {changes.map((change, i) => (
                        <TableRow
                          key={i}
                          className={
                            change.type === "modified"
                              ? "bg-amber-50 dark:bg-amber-950/20"
                              : change.type === "added"
                                ? "bg-emerald-50 dark:bg-emerald-950/20"
                                : "bg-red-50 dark:bg-red-950/20"
                          }
                        >
                          <TableCell>
                            {change.type === "modified" && (
                              <RefreshCw className="size-3.5 text-amber-600" />
                            )}
                            {change.type === "added" && (
                              <Plus className="size-3.5 text-emerald-600" />
                            )}
                            {change.type === "removed" && (
                              <Minus className="size-3.5 text-red-600" />
                            )}
                          </TableCell>
                          <TableCell className="font-medium text-sm">
                            {change.label}
                          </TableCell>
                          <TableCell
                            className={`text-sm ${change.type === "removed" ? "line-through text-muted-foreground" : ""}`}
                          >
                            {change.oldValue || "\u2014"}
                          </TableCell>
                          <TableCell>
                            {change.type !== "removed" && (
                              <ArrowRight className="size-3.5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="text-sm font-medium">
                            {change.type === "removed"
                              ? "\u2014"
                              : change.newValue}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Badge
                      variant="outline"
                      className="bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                    >
                      <RefreshCw className="size-3 mr-1" /> Modified
                    </Badge>
                    <Badge
                      variant="outline"
                      className="bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800"
                    >
                      <Plus className="size-3 mr-1" /> Added
                    </Badge>
                    <Badge
                      variant="outline"
                      className="bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border-red-200 dark:border-red-800"
                    >
                      <Minus className="size-3 mr-1" /> Removed
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      onClick={() => handleOpenChange(false)}
                    >
                      <X className="size-4" /> Cancel
                    </Button>
                    <Button onClick={handleApply}>
                      <Check className="size-4" /> Apply Changes
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* Applying Stage */}
        {stage === "applying" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Applying amendment changes...
            </p>
          </div>
        )}

        {/* Error Stage */}
        {stage === "error" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-destructive">{error}</p>
            <Button variant="outline" onClick={() => resetState()}>
              Try Again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
