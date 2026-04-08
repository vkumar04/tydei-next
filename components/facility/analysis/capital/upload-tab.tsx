"use client"

import { useState, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileText, Loader2, X } from "lucide-react"
import { toast } from "sonner"

interface UploadTabProps {
  onExtracted?: (data: {
    contractTotal?: number
    contractLength?: number
    rebatePercent?: number
  }) => void
}

export function UploadTab({ onExtracted }: UploadTabProps) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (f: File) => {
    if (!f.type.includes("pdf")) {
      toast.error("Please upload a PDF file")
      return
    }
    setFile(f)
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append("file", f)

      const res = await fetch("/api/ai/extract-contract", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error((body as { error?: string } | null)?.error ?? "Failed to extract contract data")
      }

      const { extracted } = await res.json()

      if (extracted && onExtracted) {
        onExtracted({
          contractTotal: extracted.totalValue ?? undefined,
          contractLength: extracted.effectiveDate && extracted.expirationDate
            ? Math.max(1, Math.round(
                (new Date(extracted.expirationDate).getTime() - new Date(extracted.effectiveDate).getTime()) /
                (365.25 * 24 * 60 * 60 * 1000)
              ))
            : undefined,
          rebatePercent: extracted.terms?.[0]?.tiers?.[0]?.rebateValue ?? undefined,
        })
      }

      toast.success("Contract data extracted successfully")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed")
    } finally {
      setUploading(false)
    }
  }, [onExtracted])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Upload Capital Contract</CardTitle>
        <CardDescription>
          Upload a capital contract PDF to automatically extract and
          analyze financial terms
        </CardDescription>
      </CardHeader>
      <CardContent>
        {file && !uploading ? (
          <div className="flex items-center gap-3 p-4 rounded-lg border bg-muted/30">
            <FileText className="h-8 w-8 text-primary" />
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{file.name}</p>
              <p className="text-sm text-muted-foreground">Extracted successfully</p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setFile(null)}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div
            className="border-2 border-dashed rounded-lg p-8 text-center border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer"
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
          >
            <input
              ref={inputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
            />
            <div className="space-y-3">
              <div className="flex justify-center">
                {uploading ? (
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                ) : (
                  <Upload className="h-10 w-10 text-muted-foreground" />
                )}
              </div>
              {uploading ? (
                <>
                  <p className="font-medium">Extracting contract data...</p>
                  <p className="text-sm text-muted-foreground">This may take a moment</p>
                </>
              ) : (
                <>
                  <p className="font-medium">
                    Drag &amp; drop a capital contract PDF
                  </p>
                  <p className="text-sm text-muted-foreground">
                    or click to browse files
                  </p>
                </>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
