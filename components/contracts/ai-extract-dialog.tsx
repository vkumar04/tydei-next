"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Upload, Loader2, Sparkles, FileText, Cpu, ChevronDown, AlertTriangle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Textarea } from "@/components/ui/textarea"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AIExtractReview } from "@/components/contracts/ai-extract-review"
import type { ExtractedContractData } from "@/lib/ai/schemas"
import type { ContractPricingItem } from "@/lib/actions/pricing-files"

interface AIExtractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExtracted: (data: ExtractedContractData, s3Key?: string, fileName?: string, pricingItems?: ContractPricingItem[], pricingCategories?: string[]) => void
  /**
   * When the dialog opens with an initialFile, extraction kicks off
   * immediately — the caller already gestured (drop/click) so we skip
   * the in-dialog "Upload" button. Each new `initialFile` instance
   * retriggers; pass a fresh `File` each time the user drops.
   */
  initialFile?: File | null
}

type Stage = "upload" | "extracting" | "review" | "error"

const STEPS = [
  { label: "Uploading document", icon: Upload, target: 15 },
  { label: "Reading contract PDF", icon: FileText, target: 50 },
  { label: "Structuring extracted data", icon: Cpu, target: 85 },
] as const

export function AIExtractDialog({
  open,
  onOpenChange,
  onExtracted,
  initialFile,
}: AIExtractDialogProps) {
  const [stage, setStage] = useState<Stage>("upload")
  const [progress, setProgress] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [extracted, setExtracted] = useState<ExtractedContractData | null>(null)
  const [s3Key, setS3Key] = useState<string | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [error, setError] = useState("")
  const [fileName, setFileName] = useState("")
  const [userInstructions, setUserInstructions] = useState("")
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const [fileSizeWarning, setFileSizeWarning] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Track the last `initialFile` we kicked extraction for so a parent
  // re-rendering with the same File reference doesn't re-trigger the upload.
  const processedInitialFileRef = useRef<File | null>(null)

  const quickFillExamples = [
    "This is a usage-based rebate contract",
    "Extract tier thresholds and rebate percentages",
    "Focus on product categories and pricing tiers",
    "This contract has capital equipment commitments",
  ]

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
        // Slow down as we approach the target
        const remaining = target - p
        const increment = Math.max(0.3, remaining * 0.04)
        return Math.min(target, p + increment)
      })
    }, 500)
    return stopTick
  }, [stage, stepIndex, stopTick])

  async function handleFile(file: File) {
    const MAX_WARN_SIZE = 4 * 1024 * 1024 // 4MB
    if (file.size > MAX_WARN_SIZE) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1)
      setFileSizeWarning(
        `This file is large (${sizeMB} MB). AI extraction may take longer than usual.`
      )
    } else {
      setFileSizeWarning("")
    }

    setStage("extracting")
    setProgress(0)
    setStepIndex(0)
    setFileName(file.name)

    try {
      const formData = new FormData()
      formData.append("file", file)
      if (userInstructions.trim()) {
        formData.append("userInstructions", userInstructions.trim())
      }

      // Step 1: Upload
      setStepIndex(0)
      setProgress(10)

      // Step 2: Reading — the server reads the PDF and calls AI step 1
      setStepIndex(1)

      // 2026-04-26: streaming endpoint, rebuilt on streamObject (the
      // purpose-built API for streaming structured output). The earlier
      // streamText+Output.object approach left textStream empty when
      // structuredOutputMode=jsonTool, producing 200+empty body and a
      // generic "Extraction failed" toast. streamObject's textStream
      // emits incrementally-valid JSON chunks the buffer-then-parse loop
      // below handles correctly.
      const res = await fetch("/api/ai/extract-contract/stream", {
        method: "POST",
        body: formData,
      })

      setStepIndex(2)
      setProgress(40)

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as
          | { error?: string; details?: string }
          | null
        const head = body?.error ?? "Extraction failed"
        const tail = body?.details ? ` — ${body.details}` : ""
        throw new Error(`${head}${tail}`)
      }
      if (!res.body) throw new Error("No response stream")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      let lastValid: { extracted?: unknown; confidence?: number; s3Key?: string; cached?: boolean } | null = null

      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        // Best-effort partial parse — the AI SDK's text stream emits
        // chunks of valid-but-incremental JSON. We retry parse on each
        // chunk; failures are normal mid-stream.
        try {
          const parsed = JSON.parse(buffer)
          if (parsed && typeof parsed === "object") {
            // Cache-hit envelope shape: { extracted, confidence, s3Key, cached, done }
            if ("extracted" in parsed) {
              lastValid = parsed
            } else {
              // Streaming partial — the JSON is the extracted shape itself.
              lastValid = { extracted: parsed }
            }
            // Update review state progressively.
            if (lastValid?.extracted) {
              setExtracted(lastValid.extracted as ExtractedContractData)
            }
            const pct = Math.min(95, 40 + (buffer.length / 8000) * 50)
            setProgress(Math.round(pct))
          }
        } catch {
          // Not yet a valid JSON document — keep reading.
        }
      }

      if (!lastValid) throw new Error("Empty response from extractor")

      setProgress(100)
      setS3Key(lastValid.s3Key ?? null)
      setConfidence(lastValid.confidence ?? 0.9)
      setStage("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract contract data. Please try again.")
      setStage("error")
    }
  }

  // Auto-start extraction when opened with an initialFile (e.g. from the
  // hero drop-zone). We compare against the ref so re-renders with the
  // same File don't re-trigger. Reset the ref when the dialog closes so
  // reopening with the same file (after a replace) works.
  useEffect(() => {
    if (!open) {
      processedInitialFileRef.current = null
      return
    }
    if (
      initialFile &&
      processedInitialFileRef.current !== initialFile &&
      stage === "upload"
    ) {
      processedInitialFileRef.current = initialFile
      void handleFile(initialFile)
    }
    // handleFile closes over setState only, stable; intentional minimal deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialFile, stage])

  function handleAccept(data: ExtractedContractData, pricingItems?: ContractPricingItem[], pricingCategories?: string[]) {
    onExtracted(data, s3Key ?? undefined, fileName || undefined, pricingItems, pricingCategories)
    onOpenChange(false)
    setStage("upload")
    setExtracted(null)
    setS3Key(null)
    setFileSizeWarning("")
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" /> AI Contract Extraction
          </DialogTitle>
          <DialogDescription>
            Upload a PDF, DOCX, or TXT document to auto-fill the contract fields.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.txt,.docx"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) handleFile(file)
          }}
        />

        {stage === "upload" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">
              Upload a contract document and AI will extract the key fields
            </p>
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" /> Upload Contract (PDF / DOCX / TXT)
            </Button>

            <Collapsible
              open={instructionsOpen}
              onOpenChange={setInstructionsOpen}
              className="w-full max-w-md"
            >
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex items-center gap-2 text-muted-foreground mx-auto"
                >
                  <ChevronDown
                    className={`size-4 transition-transform ${instructionsOpen ? "rotate-180" : ""}`}
                  />
                  AI Instructions (optional)
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3">
                <Textarea
                  placeholder="Add hints to guide the AI extraction..."
                  value={userInstructions}
                  onChange={(e) => setUserInstructions(e.target.value)}
                  rows={3}
                  className="text-sm"
                />
                <div className="flex flex-wrap gap-2">
                  {quickFillExamples.map((example) => (
                    <Button
                      key={example}
                      variant="outline"
                      size="sm"
                      className="text-xs h-7"
                      onClick={() => setUserInstructions(example)}
                    >
                      {example}
                    </Button>
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {stage === "extracting" && (
          <div className="flex flex-col items-center gap-6 py-8">
            {fileName && (
              <p className="text-xs text-muted-foreground truncate max-w-xs">{fileName}</p>
            )}
            {fileSizeWarning && (
              <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200 max-w-sm">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{fileSizeWarning}</AlertDescription>
              </Alert>
            )}
            <div className="flex flex-col gap-3 w-72">
              {STEPS.map((step, i) => {
                const StepIcon = step.icon
                const isActive = i === stepIndex
                const isDone = i < stepIndex
                return (
                  <div key={i} className={`flex items-center gap-3 text-sm transition-opacity ${isActive ? "opacity-100" : isDone ? "opacity-50" : "opacity-30"}`}>
                    {isActive ? (
                      <Loader2 className="size-4 animate-spin text-primary shrink-0" />
                    ) : isDone ? (
                      <StepIcon className="size-4 text-emerald-500 shrink-0" />
                    ) : (
                      <StepIcon className="size-4 shrink-0" />
                    )}
                    <span className={isActive ? "font-medium" : ""}>{step.label}</span>
                  </div>
                )
              })}
            </div>
            <Progress value={progress} className="h-2 w-72" />
            <p className="text-xs text-muted-foreground">This may take 1-3 minutes for large documents</p>
          </div>
        )}

        {stage === "review" && extracted && (
          <AIExtractReview
            extracted={extracted}
            confidence={confidence}
            onAccept={handleAccept}
          />
        )}

        {stage === "error" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-destructive text-center max-w-md break-words">
              {error}
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setStage("upload")
                setError("")
              }}
            >
              Try Again
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
