"use client"

import { useState } from "react"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { FileUploadDialog } from "./file-upload-dialog"
import type { IngestProformaResult } from "@/lib/actions/proforma-statements"

/**
 * Upload a facility's Steady State Proforma so the Dividend/DCF model runs on
 * the real statement instead of 22 hand-typed fields (Charles 2026-08-10).
 * Assigns to the same facilityKey space as the payor-volume upload, so one
 * facility selection picks up both.
 */
export function ProformaUploadDialog({
  open,
  onOpenChange,
  facilities,
  onImported,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  facilities: { id: string; name: string }[]
  onImported?: (result: IngestProformaResult) => void
}) {
  const [target, setTarget] = useState<"connected" | "unconnected">(
    facilities.length > 0 ? "connected" : "unconnected",
  )
  const [connectedId, setConnectedId] = useState(facilities[0]?.id ?? "")
  const [adhocName, setAdhocName] = useState("")

  return (
    <FileUploadDialog<IngestProformaResult>
      open={open}
      onOpenChange={onOpenChange}
      title="Upload P&L statement"
      description="Load the facility's Steady State Proforma. One row per line item, with the label in one column and the amount in another — e.g. “Medical supplies and services | 12,316,248”. Accounting negatives in parentheses are understood."
      endpoint="/api/import-proforma"
      buildFields={(): Record<string, string> | null => {
        if (target === "connected") {
          return connectedId ? { facilityId: connectedId } : null
        }
        const trimmed = adhocName.trim()
        return trimmed ? { adhocName: trimmed } : null
      }}
      missingFieldsMessage={
        target === "connected"
          ? "Pick the facility this statement belongs to."
          : "Enter a name for the facility this statement belongs to."
      }
      onImported={onImported}
      successMessage={(r) =>
        `Loaded ${r.matchedCount} P&L line${r.matchedCount === 1 ? "" : "s"} for ${r.facilityLabel}`
      }
    >
      <div className="flex flex-col gap-3">
        <Label className="text-xs text-muted-foreground">
          Assign to facility
        </Label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={() => setTarget("connected")}
            aria-pressed={target === "connected"}
            className={`flex flex-1 flex-col gap-1 rounded-md border p-3 text-left ${
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
            className={`flex flex-1 flex-col gap-1 rounded-md border p-3 text-left ${
              target === "unconnected"
                ? "border-primary bg-primary/5"
                : "border-border"
            }`}
          >
            <span className="text-sm font-medium">Unconnected facility</span>
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
    </FileUploadDialog>
  )
}
