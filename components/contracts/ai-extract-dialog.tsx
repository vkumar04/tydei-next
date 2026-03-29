"use client"

import { useState, useRef } from "react"
import { Upload, Loader2, Sparkles } from "lucide-react"
import {
  Dialog,
  DialogContent,
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

export function AIExtractDialog({
  open,
  onOpenChange,
  onExtracted,
}: AIExtractDialogProps) {
  const [stage, setStage] = useState<Stage>("upload")
  const [progress, setProgress] = useState(0)
  const [extracted, setExtracted] = useState<ExtractedContractData | null>(null)
  const [confidence, setConfidence] = useState(0)
  const [error, setError] = useState("")
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setStage("extracting")
    setProgress(30)

    try {
      const formData = new FormData()
      formData.append("file", file)
      setProgress(60)

      const res = await fetch("/api/ai/extract-contract", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) throw new Error("Extraction failed")

      const data = await res.json()
      setProgress(100)
      setExtracted(data.extracted)
      setConfidence(data.confidence)
      setStage("review")
    } catch {
      setError("Failed to extract contract data. Please try again.")
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
          <div className="flex flex-col items-center gap-4 py-8">
            <Loader2 className="size-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Extracting contract data...
            </p>
            <Progress value={progress} className="h-2 w-64" />
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
