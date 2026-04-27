"use client"

import { useState, useEffect } from "react"
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { Plus, Trash2 } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { queryKeys } from "@/lib/query-keys"
import { getVendorDivisions, setVendorDivisions } from "@/lib/actions/vendor-divisions"
import type { VendorDivisionRow } from "@/lib/actions/vendor-divisions"

// ─── Local draft type (mirrors VendorDivisionRow but id is optional for new rows) ─

interface DivisionDraft {
  id?: string
  name: string
  code: string
  categories: string
}

function rowToDraft(row: VendorDivisionRow): DivisionDraft {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    categories: row.categories.join(", "),
  }
}

function blankDraft(): DivisionDraft {
  return { name: "", code: "", categories: "" }
}

// ─── Component ────────────────────────────────────────────────────

export function VendorDivisionsCard() {
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.settings.vendorDivisions(),
    queryFn: () => getVendorDivisions(),
  })

  const [drafts, setDrafts] = useState<DivisionDraft[]>([])
  const [dirty, setDirty] = useState(false)

  // Sync server data → local drafts (only when not dirty to avoid overwriting edits)
  useEffect(() => {
    if (data && !dirty) {
      setDrafts(data.map(rowToDraft))
    }
  }, [data, dirty])

  const save = useMutation({
    mutationFn: () =>
      setVendorDivisions(
        drafts.map((d) => ({
          name: d.name.trim(),
          code: d.code.trim(),
          categories: d.categories
            .split(",")
            .map((c) => c.trim())
            .filter(Boolean),
        })),
      ),
    onSuccess: () => {
      setDirty(false)
      void qc.invalidateQueries({ queryKey: queryKeys.settings.vendorDivisions() })
      toast.success("Divisions saved")
    },
    onError: (err: unknown) => {
      const message = err instanceof Error ? err.message : "Unknown error"
      toast.error(`Failed to save divisions: ${message}`)
    },
  })

  function addRow() {
    setDrafts((prev) => [...prev, blankDraft()])
    setDirty(true)
  }

  function removeRow(index: number) {
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setDirty(true)
  }

  function updateRow(index: number, field: keyof DivisionDraft, value: string) {
    setDrafts((prev) =>
      prev.map((d, i) => (i === index ? { ...d, [field]: value } : d)),
    )
    setDirty(true)
  }

  if (isLoading) {
    return <Skeleton className="h-48 rounded-xl" />
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Divisions</CardTitle>
        <CardDescription>
          Define the divisions (business units) within your organization. Each division can
          optionally be associated with product categories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {drafts.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No divisions yet. Click &ldquo;Add division&rdquo; to get started.
          </p>
        )}

        {drafts.length > 0 && (
          <div className="space-y-3">
            {/* Header row */}
            <div className="grid grid-cols-[1fr_1fr_2fr_auto] gap-3">
              <Label className="text-xs text-muted-foreground">Name</Label>
              <Label className="text-xs text-muted-foreground">Code</Label>
              <Label className="text-xs text-muted-foreground">Categories (comma-separated)</Label>
              <span />
            </div>

            {drafts.map((draft, index) => (
              <div key={draft.id ?? `new-${index}`} className="grid grid-cols-[1fr_1fr_2fr_auto] items-center gap-3">
                <Input
                  value={draft.name}
                  onChange={(e) => updateRow(index, "name", e.target.value)}
                  placeholder="e.g. Orthopedics"
                  maxLength={100}
                />
                <Input
                  value={draft.code}
                  onChange={(e) => updateRow(index, "code", e.target.value)}
                  placeholder="e.g. ORTHO"
                  maxLength={50}
                />
                <Input
                  value={draft.categories}
                  onChange={(e) => updateRow(index, "categories", e.target.value)}
                  placeholder="e.g. Implants, Instruments"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  onClick={() => removeRow(index)}
                  aria-label="Remove division"
                >
                  <Trash2 className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" variant="outline" size="sm" onClick={addRow} className="gap-2">
            <Plus className="h-4 w-4" />
            Add division
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate()}
          >
            {save.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
