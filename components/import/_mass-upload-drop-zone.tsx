"use client"

import { UploadIcon, SparklesIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

interface MassUploadDropZoneProps {
  isDragging: boolean
  isProcessing: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
  onFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void
}

/** Props-driven drop zone for MassUpload — all handlers come from the parent. */
export function MassUploadDropZone({
  isDragging,
  isProcessing,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
}: MassUploadDropZoneProps) {
  return (
    <div
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`relative flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-8 transition-colors ${
        isDragging
          ? "border-primary bg-primary/5"
          : "border-muted-foreground/25 hover:border-muted-foreground/50"
      } ${isProcessing ? "pointer-events-none opacity-50" : ""}`}
    >
      <div className="flex items-center justify-center h-16 w-16 rounded-full bg-primary/10 mb-4">
        <UploadIcon className="h-8 w-8 text-primary" />
      </div>
      <p className="mb-1 text-lg font-medium">Drop files here</p>
      <p className="text-sm text-muted-foreground mb-4">
        Upload contracts, invoices, purchase orders, and more — all at once
      </p>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
        <SparklesIcon className="h-3 w-3" />
        AI will automatically classify and extract data from each document
      </div>
      <label aria-label="Select files to upload">
        <Button variant="outline" asChild disabled={isProcessing}>
          <span>Select Files</span>
        </Button>
        <input
          type="file"
          accept=".pdf,.csv,.xlsx,.xls,.txt"
          multiple
          className="hidden"
          onChange={onFileSelect}
          disabled={isProcessing}
        />
      </label>
    </div>
  )
}
