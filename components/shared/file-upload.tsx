"use client"

import { useState, useRef } from "react"
import { Upload, X, FileText } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"

interface FileUploadProps {
  onUpload: (file: File) => Promise<string>
  accept?: string
  label?: string
  existingUrl?: string
}

export function FileUpload({ onUpload, accept, label = "Upload file", existingUrl }: FileUploadProps) {
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [url, setUrl] = useState(existingUrl ?? "")
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setError(null)
    setUploading(true)
    setProgress(30)
    try {
      const result = await onUpload(file)
      setProgress(100)
      setUrl(result)
    } catch (err) {
      setProgress(0)
      setError(err instanceof Error ? err.message : `Upload of ${file.name} failed`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />
      {url ? (
        <div className="flex items-center gap-2 rounded-md border p-2">
          <FileText className="size-4 text-muted-foreground" />
          <span className="flex-1 truncate text-sm">{url.split("/").pop()}</span>
          <Button type="button" variant="ghost" size="icon" onClick={() => setUrl("")}>
            <X className="size-4" />
          </Button>
        </div>
      ) : (
        <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} disabled={uploading}>
          <Upload className="size-4" /> {label}
        </Button>
      )}
      {uploading && <Progress value={progress} className="h-1.5" />}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
