"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { FileUploadDialog } from "./file-upload-dialog"
import type { IngestMedicareRatesResult } from "@/lib/actions/medicare-rate-sets"

/**
 * Upload a CMS ASC rate table that shadows the built-in CY2025 national
 * snapshot (Charles 2026-08-10). Named sets, so a rep can hold a publication
 * year and a locality-adjusted table side by side and pick which applies.
 */
export function MedicareRatesUploadDialog({
  open,
  onOpenChange,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported?: (result: IngestMedicareRatesResult) => void
}) {
  const [name, setName] = useState("")

  return (
    <FileUploadDialog<IngestMedicareRatesResult>
      open={open}
      onOpenChange={onOpenChange}
      title="Upload Medicare rates"
      description="Load a CMS ASC rate table. Expected columns: Procedure Group, CPT/HCPCS code, and Rate. Group names are matched to your payor volume case-insensitively; anything not in the file falls back to the built-in CY2025 national rates."
      endpoint="/api/import-medicare-rates"
      buildFields={() => (name.trim() ? { name: name.trim() } : null)}
      missingFieldsMessage="Give the rate set a name before importing, e.g. “CY2026 National”."
      onImported={(r) => {
        setName("")
        onImported?.(r)
      }}
      successMessage={(r) =>
        `Loaded ${r.rateCount} rate${r.rateCount === 1 ? "" : "s"} into “${r.name}”${
          r.skipped > 0 ? ` · ${r.skipped} row${r.skipped === 1 ? "" : "s"} skipped` : ""
        }`
      }
    >
      <div className="flex flex-col gap-1.5">
        <Label
          htmlFor="medicare-rate-set-name"
          className="text-xs text-muted-foreground"
        >
          Rate set name
        </Label>
        <Input
          id="medicare-rate-set-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. CY2026 National, or CY2026 Boston locality"
        />
        <span className="text-[11px] text-muted-foreground">
          Re-uploading under an existing name replaces that set.
        </span>
      </div>
    </FileUploadDialog>
  )
}
