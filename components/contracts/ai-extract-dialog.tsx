"use client"

import { useState, useRef, useEffect, useCallback } from "react"
import { Upload, Loader2, Sparkles, FileText, Cpu } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { AIExtractReview } from "@/components/contracts/ai-extract-review"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface AIExtractDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onExtracted: (data: ExtractedContractData) => void
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
}: AIExtractDialogProps) {
  const [stage, setStage] = useState<Stage>("upload")
  const [progress, setProgress] = useState(0)
  const [stepIndex, setStepIndex] = useState(0)
  const [extracted, setExtracted] = useState<ExtractedContractData | null>(null)
  const [confidence, setConfidence] = useState(0)
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
        // Slow down as we approach the target
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

      // Step 1: Upload
      setStepIndex(0)
      setProgress(10)

      // Step 2: Reading — the server reads the PDF and calls AI step 1
      setStepIndex(1)

      const res = await fetch("/api/ai/extract-contract", {
        method: "POST",
        body: formData,
      })

      // Step 3: Structuring — by the time we get the response, both AI steps are done
      setStepIndex(2)
      setProgress(90)

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error((body as { error?: string } | null)?.error || "Extraction failed")
      }

      const data = await res.json()
      setProgress(100)
      setExtracted(data.extracted)
      setConfidence(data.confidence)
      setStage("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to extract contract data. Please try again.")
      setStage("error")
    }
  }

  function handleAccept(data: ExtractedContractData) {
    onExtracted(data)
    onOpenChange(false)
    setStage("upload")
    setExtracted(null)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5" /> AI Contract Extraction
          </DialogTitle>
          <DialogDescription>
            Upload a PDF document to auto-fill the contract fields.
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

        {stage === "upload" && (
          <div className="flex flex-col items-center gap-4 py-8">
            <p className="text-sm text-muted-foreground">
              Upload a contract PDF and AI will extract the key fields
            </p>
            <Button onClick={() => inputRef.current?.click()}>
              <Upload className="size-4" /> Upload Contract PDF
            </Button>
          </div>
        )}

        {stage === "extracting" && (
          <div className="flex flex-col items-center gap-6 py-8">
            {fileName && (
              <p className="text-xs text-muted-foreground truncate max-w-xs">{fileName}</p>
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
            <p className="text-sm text-destructive">{error}</p>
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
