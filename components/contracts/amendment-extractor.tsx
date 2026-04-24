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
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
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
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
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
import { cn } from "@/lib/utils"
import type { AmendmentChange } from "@/app/api/ai/extract-amendment/route"

interface AmendmentExtractorProps {
  contractId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onApplied: () => void
}

// v0 3-stage amendment flow mapping:
//   1. upload    -> "upload" (file picker) + "extracting" (progress feedback)
//   2. review    -> "review" change-diff table (oldValue vs newValue);
//                   pricing/term changes render inline here
//   3. confirm   -> validation questions + "Apply Changes" -> "applying" -> "done"
// "error" is an out-of-band recovery state, not part of the v0 happy path.
export type Stage =
  | "upload"
  | "extracting"
  | "review"
  | "confirm"
  | "applying"
  | "done"
  | "error"

/**
 * Pure helper: returns the next stage in the v0 amendment flow, or `null` if
 * `current` is the terminal stage (or not in the ordered flow). The order
 * mirrors the 3-stage breadcrumb plus the two runtime states that follow
 * user confirmation: upload → review → confirm → applying → done.
 */
export function nextStage(current: Stage): Stage | null {
  const order: Stage[] = [
    "upload",
    "review",
    "confirm",
    "applying",
    "done",
  ]
  const i = order.indexOf(current)
  return i >= 0 && i < order.length - 1 ? order[i + 1] : null
}

/**
 * Sanitize a raw string from the AI amendment extractor into a finite number.
 * Strips `$`, `,`, whitespace, and currency/percent suffixes before parsing.
 * Throws when the result is NaN or infinite — callers should surface the
 * error via toast and block the apply rather than silently coercing to 0
 * (see QA bug detail-5: `"$350,000"` previously parsed to NaN and clobbered
 * `totalValue` with 0).
 */
export function sanitizeNumeric(raw: string): number {
  if (typeof raw !== "string") {
    throw new Error(`Expected string, received ${typeof raw}`)
  }
  // Strip anything that isn't a digit, decimal point, or leading minus.
  // This removes `$`, `,`, whitespace, `USD`, `%`, etc.
  const cleaned = raw.replace(/[^\d.-]/g, "")
  if (cleaned === "" || cleaned === "-" || cleaned === "." || cleaned === "-.") {
    throw new Error(`Could not parse "${raw}" as a number`)
  }
  const parsed = parseFloat(cleaned)
  if (!Number.isFinite(parsed)) {
    throw new Error(`Could not parse "${raw}" as a number`)
  }
  return parsed
}

/**
 * Integer variant of `sanitizeNumeric`. Truncates toward zero after
 * sanitization. Throws on unparseable input.
 */
export function sanitizeInteger(raw: string): number {
  const n = sanitizeNumeric(raw)
  return Math.trunc(n)
}

type ConfidenceLevel = "high" | "medium" | "low"

const STEPS = [
  { label: "Uploading amendment", icon: Upload, target: 15 },
  { label: "Reading amendment PDF", icon: FileText, target: 50 },
  { label: "Comparing against contract", icon: Cpu, target: 85 },
] as const

function getConfidenceLevel(changeCount: number): ConfidenceLevel {
  if (changeCount >= 5) return "high"
  if (changeCount >= 2) return "medium"
  return "low"
}

const confidenceConfig: Record<
  ConfidenceLevel,
  {
    label: string
    description: string
    icon: typeof ShieldCheck
    badgeClass: string
    bgClass: string
  }
> = {
  high: {
    label: "High Confidence",
    description:
      "Multiple changes detected and cross-referenced. Review before applying.",
    icon: ShieldCheck,
    badgeClass:
      "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
    bgClass: "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800",
  },
  medium: {
    label: "Medium Confidence",
    description:
      "Some changes detected but manual verification recommended.",
    icon: ShieldAlert,
    badgeClass:
      "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800",
    bgClass: "bg-amber-50 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800",
  },
  low: {
    label: "Low Confidence",
    description:
      "Few changes detected. Manual review strongly recommended.",
    icon: ShieldQuestion,
    badgeClass:
      "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800",
    bgClass: "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800",
  },
}

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

  // Validation toggles (informational only)
  const [supersedesOriginal, setSupersedesOriginal] = useState(false)
  const [updateExpiration, setUpdateExpiration] = useState(false)
  const [applyToPOs, setApplyToPOs] = useState(false)

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
      const updatePayload: Record<string, unknown> = {}

      for (const change of changes) {
        if (change.type === "removed") continue

        switch (change.field) {
          case "effectiveDate":
          case "expirationDate":
            updatePayload[change.field] = change.newValue
            break
          case "totalValue":
          case "annualValue":
            try {
              updatePayload[change.field] = sanitizeNumeric(change.newValue)
            } catch (err) {
              const message =
                err instanceof Error ? err.message : String(err)
              toast.error(
                `Could not parse ${change.label} value "${change.newValue}". ${message}`,
              )
              setStage("review")
              return
            }
            break
          case "terminationNoticeDays":
            try {
              updatePayload[change.field] = sanitizeInteger(change.newValue)
            } catch (err) {
              const message =
                err instanceof Error ? err.message : String(err)
              toast.error(
                `Could not parse ${change.label} value "${change.newValue}". ${message}`,
              )
              setStage("review")
              return
            }
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
    setSupersedesOriginal(false)
    setUpdateExpiration(false)
    setApplyToPOs(false)
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) resetState()
    onOpenChange(nextOpen)
  }

  const confidence = getConfidenceLevel(changes.length)
  const confConfig = confidenceConfig[confidence]
  const ConfIcon = confConfig.icon

  // 3-stage breadcrumb mapping for v0 parity. Internal `extracting` maps to
  // "upload" (same breadcrumb step), and `review`/`applying`/`done` map to
  // the corresponding breadcrumb step. `error` is out-of-band.
  const stages: Array<{ key: string; label: string }> = [
    { key: "upload", label: "Upload" },
    { key: "review", label: "Review" },
    { key: "confirm", label: "Confirm" },
  ]
  const breadcrumbKey: string =
    stage === "extracting"
      ? "upload"
      : stage === "applying" || stage === "done"
        ? "confirm"
        : stage
  const currentIndex = stages.findIndex((s) => s.key === breadcrumbKey)

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitCompareArrows className="size-5" /> Amendment Extractor
          </DialogTitle>
          <DialogDescription>
            Upload an amendment PDF to extract and compare changes against the
            current contract.
          </DialogDescription>
        </DialogHeader>

        {stage !== "error" && (
          <div className="flex items-center gap-1 text-xs">
            {stages.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1">
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5",
                    i < currentIndex &&
                      "border-emerald-500 text-emerald-700 dark:text-emerald-400",
                    i === currentIndex &&
                      "border-foreground bg-foreground text-background",
                    i > currentIndex && "text-muted-foreground",
                  )}
                >
                  {i + 1}. {s.label}
                </span>
                {i < stages.length - 1 && (
                  <span className="text-muted-foreground">→</span>
                )}
              </div>
            ))}
          </div>
        )}

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
            {/* Confidence Badge */}
            <div className={`flex items-start gap-3 rounded-lg border p-3 ${confConfig.bgClass}`}>
              <ConfIcon className="size-5 mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">{confConfig.label}</p>
                <p className="text-xs text-muted-foreground">
                  {confConfig.description}
                </p>
              </div>
              <Badge variant="outline" className={`ml-auto shrink-0 ${confConfig.badgeClass}`}>
                {changes.length} change{changes.length !== 1 ? "s" : ""}
              </Badge>
            </div>

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

                <div className="rounded-md border overflow-x-auto">
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
                            className={`text-sm whitespace-normal break-words align-top ${change.type === "removed" ? "line-through text-muted-foreground" : ""}`}
                          >
                            {change.oldValue || "\u2014"}
                          </TableCell>
                          <TableCell className="align-top">
                            {change.type !== "removed" && (
                              <ArrowRight className="size-3.5 text-muted-foreground" />
                            )}
                          </TableCell>
                          <TableCell className="text-sm font-medium whitespace-normal break-words align-top">
                            {change.type === "removed"
                              ? "\u2014"
                              : change.newValue}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Validation Questions */}
                <Card className="border-primary/30">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-sm font-medium">
                      Validation Questions
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Review these options before applying the amendment.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <Label
                        htmlFor="supersedes"
                        className="text-sm font-normal leading-snug cursor-pointer"
                      >
                        Does this amendment supersede the original contract
                        terms?
                      </Label>
                      <Switch
                        id="supersedes"
                        checked={supersedesOriginal}
                        onCheckedChange={setSupersedesOriginal}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label
                        htmlFor="update-exp"
                        className="text-sm font-normal leading-snug cursor-pointer"
                      >
                        Should the effective date update the contract
                        expiration?
                      </Label>
                      <Switch
                        id="update-exp"
                        checked={updateExpiration}
                        onCheckedChange={setUpdateExpiration}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-4">
                      <Label
                        htmlFor="apply-pos"
                        className="text-sm font-normal leading-snug cursor-pointer"
                      >
                        Apply pricing changes to existing purchase orders?
                      </Label>
                      <Switch
                        id="apply-pos"
                        checked={applyToPOs}
                        onCheckedChange={setApplyToPOs}
                      />
                    </div>
                  </CardContent>
                </Card>

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
