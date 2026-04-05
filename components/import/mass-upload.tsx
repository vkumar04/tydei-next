"use client"

import { useCallback, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { Upload, Sparkles, PlayCircle } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  FileClassificationCard,
  CLASSIFICATION_CONFIG,
  type QueuedFile,
  type DocumentClassification,
} from "@/components/import/file-classification-card"

interface MassUploadProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

let fileIdCounter = 0

export function MassUpload({ facilityId, open, onOpenChange }: MassUploadProps) {
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const classifyingRef = useRef(false)
  const router = useRouter()

  // ── Classify a single file via API ────────────────────────────────
  const classifyFile = useCallback(async (qf: QueuedFile) => {
    setQueue((prev) =>
      prev.map((f) =>
        f.id === qf.id ? { ...f, status: "classifying" as const } : f
      )
    )

    try {
      const form = new FormData()
      form.append("file", qf.file)
      form.append("fileName", qf.file.name)

      const res = await fetch("/api/ai/classify-document", {
        method: "POST",
        body: form,
      })

      if (!res.ok) throw new Error("Classification failed")

      const data = (await res.json()) as {
        classification: DocumentClassification
        confidence: number
      }

      setQueue((prev) =>
        prev.map((f) =>
          f.id === qf.id
            ? {
                ...f,
                status: "classified" as const,
                classification: data.classification,
                confidence: data.confidence,
              }
            : f
        )
      )
    } catch {
      setQueue((prev) =>
        prev.map((f) =>
          f.id === qf.id
            ? { ...f, status: "error" as const, error: "Classification failed" }
            : f
        )
      )
    }
  }, [])

  // ── Process the classification queue sequentially ─────────────────
  const processQueue = useCallback(
    async (files: QueuedFile[]) => {
      if (classifyingRef.current) return
      classifyingRef.current = true

      for (const f of files) {
        if (f.status === "pending") {
          await classifyFile(f)
        }
      }

      classifyingRef.current = false
    },
    [classifyFile]
  )

  // ── Add files to the queue ────────────────────────────────────────
  const addFiles = useCallback(
    (fileList: FileList | File[]) => {
      const newFiles: QueuedFile[] = Array.from(fileList).map((file) => ({
        id: `file-${++fileIdCounter}`,
        file,
        status: "pending" as const,
      }))

      setQueue((prev) => {
        const updated = [...prev, ...newFiles]
        // Kick off classification for new pending files
        processQueue(newFiles)
        return updated
      })
    },
    [processQueue]
  )

  // ── Handlers ──────────────────────────────────────────────────────
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      if (e.dataTransfer.files.length > 0) {
        addFiles(e.dataTransfer.files)
      }
    },
    [addFiles]
  )

  const handleFileInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        addFiles(e.target.files)
        // Reset so user can re-pick the same file
        e.target.value = ""
      }
    },
    [addFiles]
  )

  const handleRemove = useCallback((id: string) => {
    setQueue((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const handleOverride = useCallback(
    (id: string, classification: DocumentClassification) => {
      setQueue((prev) =>
        prev.map((f) =>
          f.id === id ? { ...f, classification, confidence: 1.0 } : f
        )
      )
    },
    []
  )

  const handleProcessAll = useCallback(() => {
    setIsProcessing(true)
    // Navigate to the most relevant page based on the first classified file
    const classified = queue.filter((f) => f.status === "classified")
    if (classified.length === 0) {
      setIsProcessing(false)
      return
    }

    // Group by classification to determine primary action
    const counts: Partial<Record<DocumentClassification, number>> = {}
    for (const f of classified) {
      if (f.classification) {
        counts[f.classification] = (counts[f.classification] ?? 0) + 1
      }
    }

    // Find the most common classification
    const primary = Object.entries(counts).sort(
      ([, a], [, b]) => b - a
    )[0]?.[0] as DocumentClassification | undefined

    onOpenChange(false)
    setQueue([])
    setIsProcessing(false)

    // Route to the appropriate page
    switch (primary) {
      case "contract":
      case "amendment":
        router.push("/dashboard/contracts/new")
        break
      case "cog_data":
      case "cog_report":
        router.push("/dashboard/cog-data?autoImport=true")
        break
      case "pricing_file":
      case "pricing_schedule":
        router.push("/dashboard/cog-data?tab=pricing")
        break
      case "invoice":
      case "purchase_order":
        router.push("/dashboard/cog-data?autoImport=true")
        break
      default:
        router.push("/dashboard/cog-data")
    }
  }, [queue, onOpenChange, router])

  const classifiedCount = queue.filter((f) => f.status === "classified").length
  const allDone = queue.length > 0 && queue.every((f) => f.status === "classified" || f.status === "error")

  return (
    <Dialog
      open={open}
      onOpenChange={(val) => {
        if (!val) {
          setQueue([])
        }
        onOpenChange(val)
      }}
    >
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-xl">Mass Upload</DialogTitle>
          <DialogDescription>
            Upload multiple files and we will automatically classify each one
            using AI
          </DialogDescription>
        </DialogHeader>

        {/* Dropzone */}
        <Card
          className={cn(
            "border-2 border-dashed transition-colors cursor-pointer shrink-0",
            isDragging && "border-primary bg-primary/5"
          )}
          onDragOver={(e) => {
            e.preventDefault()
            setIsDragging(true)
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
        >
          <CardContent className="flex flex-col items-center justify-center py-8">
            <Upload className="h-8 w-8 text-muted-foreground mb-2" />
            <p className="text-sm font-medium mb-1">
              Drop files here or click to browse
            </p>
            <p className="text-xs text-muted-foreground">
              Supported: PDF, CSV, Excel (.xlsx, .xls)
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".pdf,.csv,.xlsx,.xls"
              multiple
              className="hidden"
              onChange={handleFileInput}
            />
          </CardContent>
        </Card>

        {/* File queue */}
        {queue.length > 0 && (
          <div className="flex-1 min-h-0 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                <Sparkles className="inline h-3.5 w-3.5 mr-1 text-primary" />
                {classifiedCount} of {queue.length} files classified
              </p>
            </div>

            <ScrollArea className="max-h-[40vh]">
              <div className="space-y-2 pr-3">
                {queue.map((item) => (
                  <FileClassificationCard
                    key={item.id}
                    item={item}
                    onRemove={handleRemove}
                    onOverride={handleOverride}
                  />
                ))}
              </div>
            </ScrollArea>

            {/* Action summary */}
            {allDone && classifiedCount > 0 && (
              <div className="rounded-lg border bg-muted/50 p-3 space-y-1">
                <p className="text-xs font-medium text-muted-foreground mb-2">
                  Processing plan:
                </p>
                {queue
                  .filter(
                    (f) =>
                      f.status === "classified" && f.classification !== "unknown"
                  )
                  .map((f) => (
                    <p key={f.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {f.file.name}
                      </span>{" "}
                      &rarr;{" "}
                      {f.classification
                        ? CLASSIFICATION_CONFIG[f.classification].action
                        : "Unknown action"}
                    </p>
                  ))}
              </div>
            )}

            {/* Process button */}
            <Button
              className="w-full"
              disabled={!allDone || classifiedCount === 0 || isProcessing}
              onClick={handleProcessAll}
            >
              <PlayCircle className="h-4 w-4 mr-2" />
              Process All ({classifiedCount} files)
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
