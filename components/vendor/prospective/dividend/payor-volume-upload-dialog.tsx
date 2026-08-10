"use client"

import { useCallback, useMemo, useState } from "react"
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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Loader2, Upload, FileSpreadsheet, AlertCircle, X } from "lucide-react"
import { queryKeys } from "@/lib/query-keys"

interface PayorVolumeUploadDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Connected facilities the vendor may assign the upload to. */
  facilities: { id: string; name: string }[]
  /** Called with the dataset's facilityKey after a successful import. */
  onSaved?: (facilityKey: string) => void
}

type Target = "connected" | "unconnected"

/**
 * Upload payor-reported procedure volumes (.xlsx / .csv with Procedure Group,
 * Year, Quarter, Volume columns) for a connected facility or an ad-hoc
 * prospect. The file goes to /api/import-payor-volume — parsing happens
 * server-side through the bounded xlsx parser, never in the browser.
 */
export function PayorVolumeUploadDialog({
  open,
  onOpenChange,
  facilities,
  onSaved,
}: PayorVolumeUploadDialogProps) {
  const queryClient = useQueryClient()
  const [target, setTarget] = useState<Target>(
    facilities.length > 0 ? "connected" : "unconnected",
  )
  const [connectedId, setConnectedId] = useState<string>(facilities[0]?.id ?? "")
  const [adhocName, setAdhocName] = useState("")
  const [isDragging, setIsDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  const canSave = useMemo(
    () =>
      !!file &&
      !uploading &&
      ((target === "connected" && !!connectedId) ||
        (target === "unconnected" && !!adhocName.trim())),
    [file, uploading, target, connectedId, adhocName],
  )

  const reset = () => {
    setFile(null)
    setError(null)
    setUploading(false)
  }

  const acceptFile = useCallback((f: File) => {
    const lower = f.name.toLowerCase()
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".csv")) {
      setError("Only .xlsx and .csv files are supported")
      setFile(null)
      return
    }
    setError(null)
    setFile(f)
  }, [])

  const handleSave = async () => {
    if (!file) return
    setUploading(true)
    setError(null)
    try {
      const formData = new FormData()
      formData.append("file", file)
      if (target === "connected") formData.append("facilityId", connectedId)
      else formData.append("adhocName", adhocName.trim())

      const res = await fetch("/api/import-payor-volume", {
        method: "POST",
        body: formData,
      })
      const body = (await res.json()) as {
        error?: string
        facilityKey?: string
        facilityLabel?: string
        groupCount?: number
        totalAnnualizedVolume?: number
      }
      if (!res.ok || !body.facilityKey) {
        setError(body.error ?? "Import failed")
        return
      }
      await queryClient.invalidateQueries({
        queryKey: queryKeys.prospective.all,
      })
      toast.success(
        `Loaded ${body.groupCount} procedure groups for ${body.facilityLabel} (${(body.totalAnnualizedVolume ?? 0).toLocaleString()} cases/yr)`,
      )
      onSaved?.(body.facilityKey)
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
          <DialogTitle>Upload payor volume data</DialogTitle>
          <DialogDescription>
            Load payor-reported procedure volumes for a facility. Expected
            columns: Procedure Group, Year, Quarter, Volume. Works for a
            connected facility or an ad-hoc (unconnected) prospect.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          {/* Facility target */}
          <div className="flex flex-col gap-3">
            <Label className="text-xs text-muted-foreground">
              Assign to facility
            </Label>
            <div className="flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setTarget("connected")}
                aria-pressed={target === "connected"}
                className={`flex flex-1 flex-col gap-2 rounded-md border p-3 text-left ${
                  target === "connected"
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <span className="text-sm font-medium">Connected facility</span>
                <span className="text-[11px] text-muted-foreground">
                  A facility already set up in the system.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setTarget("unconnected")}
                aria-pressed={target === "unconnected"}
                className={`flex flex-1 flex-col gap-2 rounded-md border p-3 text-left ${
                  target === "unconnected"
                    ? "border-primary bg-primary/5"
                    : "border-border"
                }`}
              >
                <span className="text-sm font-medium">
                  Unconnected facility
                </span>
                <span className="text-[11px] text-muted-foreground">
                  A prospect not yet in the system — enter a name.
                </span>
              </button>
            </div>
            {target === "connected" ? (
              <Select value={connectedId} onValueChange={setConnectedId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select facility…" />
                </SelectTrigger>
                <SelectContent>
                  {facilities.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={adhocName}
                onChange={(e) => setAdhocName(e.target.value)}
                placeholder="e.g. Coastal Surgery Center"
              />
            )}
          </div>

          {/* Dropzone / picked file */}
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
              <p className="text-sm font-medium">
                Drag &amp; drop your payor file here
              </p>
              <p className="text-[11px] text-muted-foreground">.xlsx or .csv</p>
              <label className="mt-2">
                {/* sr-only (not display:none) keeps the input in the tab
                    order so the picker opens from the keyboard. */}
                <input
                  type="file"
                  accept=".xlsx,.csv"
                  className="sr-only"
                  aria-label="Browse for a payor volume file"
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
            <div className="flex items-center gap-2 rounded-md border border-red-600/40 bg-red-600/10 px-3 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-4 w-4 shrink-0" />
              {error}
            </div>
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Importing…
              </>
            ) : (
              "Save payor data"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
