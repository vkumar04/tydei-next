"use client"

import { useRef, useState, type DragEvent } from "react"
import { CheckCircle2, Sparkles, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type DroppedFileKind = "contract" | "pricing" | "unsupported"

interface ContractPdfDropZoneProps {
  onFileSelected: (file: File, kind: DroppedFileKind) => void
  extractedFileName?: string | null
  onReplace?: () => void
}

const CONTRACT_EXTS = ["pdf", "txt", "doc", "docx"]
const PRICING_EXTS = ["csv", "xlsx", "xls"]
const ACCEPT = ".pdf,.txt,.doc,.docx,.csv,.xlsx,.xls"

function classify(file: File): DroppedFileKind {
  const ext = file.name.toLowerCase().split(".").pop() ?? ""
  if (CONTRACT_EXTS.includes(ext)) return "contract"
  if (PRICING_EXTS.includes(ext)) return "pricing"
  return "unsupported"
}

/**
 * Hero drop-zone for the New Contract page. Accepts contract documents
 * (PDF/DOC/DOCX/TXT) and pricing files (CSV/XLSX/XLS). The parent routes
 * each kind to the right backend: contract docs → AI extract; pricing
 * files → pricing-file import (queued until contract save if needed).
 */
export function ContractPdfDropZone({
  onFileSelected,
  extractedFileName,
  onReplace,
}: ContractPdfDropZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (!file) return
    onFileSelected(file, classify(file))
  }

  function handleDragOver(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    if (!isDragging) setIsDragging(true)
  }

  function handleDragLeave(e: DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setIsDragging(false)
  }

  if (extractedFileName) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950/30">
        <div className="flex items-center gap-3 min-w-0">
          <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">
              {extractedFileName}
            </p>
            <p className="text-xs text-muted-foreground">
              Contract details extracted — review the form below
            </p>
          </div>
        </div>
        {onReplace && (
          <Button variant="outline" size="sm" onClick={onReplace}>
            Replace
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      className={cn(
        "relative flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors cursor-pointer",
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50 hover:bg-muted/30",
      )}
      onClick={() => inputRef.current?.click()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault()
          inputRef.current?.click()
        }
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onFileSelected(file, classify(file))
          e.target.value = ""
        }}
      />
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
        <Upload className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="space-y-1">
        <p className="text-base font-medium">
          {isDragging
            ? "Drop the file to continue"
            : "Drop a contract or pricing file here, or click to upload"}
        </p>
        <p className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          PDF / DOC / DOCX / TXT extract with AI · CSV / XLSX import as pricing
        </p>
      </div>
    </div>
  )
}
