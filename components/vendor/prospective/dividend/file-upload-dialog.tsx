"use client"

import { useCallback, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Loader2, Upload, FileSpreadsheet, AlertCircle, X } from "lucide-react"
import { queryKeys } from "@/lib/query-keys"

/**
 * Shared dropzone + POST shell for the Dividend/DCF uploads (payor volume,
 * P&L statement, Medicare rate table). Each caller supplies the endpoint, the
 * extra form fields, and how to describe a successful import; the file
 * handling, error surfacing, and cache invalidation are identical.
 */
export function FileUploadDialog<TResult>({
  open,
  onOpenChange,
  title,
  description,
  endpoint,
  /** Extra multipart fields; return null to block submission. */
  buildFields,
  missingFieldsMessage,
  /** Rendered above the dropzone — target pickers, name inputs, etc. */
  children,
  onImported,
  successMessage,
  accept = ".xlsx,.csv",
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  endpoint: string
  buildFields: () => Record<string, string> | null
  missingFieldsMessage: string
  children?: ReactNode
  onImported?: (result: TResult) => void
  successMessage: (result: TResult) => string
  accept?: string
}) {
  const queryClient = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const reset = () => {
    setFile(null)
    setError(null)
    setUploading(false)
  }

  const acceptFile = useCallback(
    (f: File) => {
      const ok = accept
        .split(",")
        .some((ext) => f.name.toLowerCase().endsWith(ext.trim()))
      if (!ok) {
        setError(`Only ${accept} files are supported`)
        setFile(null)
        return
      }
      setError(null)
      setFile(f)
    },
    [accept],
  )

  const handleSave = async () => {
    if (!file) return
    const fields = buildFields()
    if (!fields) {
      // Never bail silently — the Import button is enabled on file presence
      // alone, so say what is still missing.
      setError(missingFieldsMessage)
      return
    }
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      for (const [k, v] of Object.entries(fields)) formData.append(k, v)

      const res = await fetch(endpoint, { method: "POST", body: formData })
      const body = (await res.json()) as TResult & { error?: string }
      if (!res.ok) {
        setError(body.error ?? "Import failed")
        return
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.prospective.all,
      })
      toast.success(successMessage(body))
      onImported?.(body)
      onOpenChange(false)
      reset()
    } catch {
      setError("Import failed — check your connection and try again.")
    } finally {
      setUploading(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o)
        if (!o) reset()
      }}
    >
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {children}

          {!file ? (
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={(e) => {
                e.preventDefault()
                setIsDragging(false)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setIsDragging(false)
                const f = e.dataTransfer.files?.[0]
                if (f) acceptFile(f)
              }}
              className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 text-center transition-colors ${
                isDragging ? "border-primary bg-primary/5" : "border-border"
              }`}
            >
              <Upload className="h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">Drag &amp; drop your file here</p>
              <p className="text-[11px] text-muted-foreground">{accept}</p>
              <label className="mt-2">
                {/* sr-only, not display:none — keeps it keyboard-reachable. */}
                <input
                  type="file"
                  accept={accept}
                  className="sr-only"
                  aria-label={`Browse for a file to ${title.toLowerCase()}`}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) acceptFile(f)
                  }}
                />
                <span className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-muted">
                  <FileSpreadsheet className="h-4 w-4" />
                  Browse files
                </span>
              </label>
            </div>
          ) : (
            <div className="flex items-center justify-between rounded-lg border border-border p-4">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium">{file.name}</span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFile(null)}
                className="h-7 gap-1"
              >
                <X className="h-3.5 w-3.5" />
                Replace
              </Button>
            </div>
          )}

          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              // Reset here too: this calls the PROP, not the Radix
              // onOpenChange wrapper below that carries the reset, so
              // cancelling would otherwise leave a stale file and error
              // banner for the next open.
              onOpenChange(false)
              reset()
            }}
          >
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!file || uploading}>
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              "Import"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
