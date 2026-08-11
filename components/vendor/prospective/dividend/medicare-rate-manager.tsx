"use client"

import { useEffect, useMemo, useState } from "react"
import { Plus, RotateCcw, ShieldCheck, SlidersHorizontal, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"
import {
  listEffectiveMedicareRates,
  type MedicareAscRate,
  type MedicareRateOverrideInput,
  type ResolvedMedicareRate,
} from "@/lib/financial-analysis/medicare-asc-rates"
import {
  useSaveMedicareRateOverrides,
  useRemoveMedicareRateOverride,
  useResetMedicareRateOverrides,
} from "@/hooks/use-dividend"

/**
 * Authoritative Medicare rate editor (Charles 2026-08-11: "need to be able to
 * adjust these"). The built-in table is an ESTIMATE — only the total-knee and
 * total-hip anchors are verified CMS figures — so a rep must be able to enter
 * the real allowable per group without uploading a whole table.
 *
 * Three sources are shown honestly, most authoritative first: a hand-entered
 * value, a row from the selected uploaded table, or the built-in estimate.
 */
interface DraftRow extends ResolvedMedicareRate {
  baseRate: number
  baseCode: string
  baseNote: string
  baseLabel: string
}

function toDraft(rows: ResolvedMedicareRate[]): DraftRow[] {
  return rows.map((r) => ({
    ...r,
    note: r.note ?? "",
    label: r.label ?? "",
    baseRate: r.medicareRate,
    baseCode: r.code,
    baseNote: r.note ?? "",
    baseLabel: r.label ?? "",
  }))
}

function isDirty(r: DraftRow): boolean {
  return (
    r.medicareRate !== r.baseRate ||
    r.code !== r.baseCode ||
    (r.note ?? "") !== r.baseNote ||
    (r.label ?? "") !== r.baseLabel
  )
}

export function MedicareRateManager({
  overrides,
  uploaded,
  onRatesChanged,
}: {
  overrides: MedicareRateOverrideInput[]
  uploaded: MedicareAscRate[] | undefined
  /** Fired after any successful rate change, so the caller can drop a manual
   *  blended-rate override that would otherwise mask the new value. */
  onRatesChanged?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<DraftRow[]>([])
  const [newGroup, setNewGroup] = useState("")
  const [newCode, setNewCode] = useState("")
  const [newRate, setNewRate] = useState("")

  const saveMutation = useSaveMedicareRateOverrides()
  const revertMutation = useRemoveMedicareRateOverride()
  const resetMutation = useResetMedicareRateOverrides()

  const effective = useMemo(
    () => listEffectiveMedicareRates({ overrides, uploaded }),
    [overrides, uploaded],
  )

  // Reseed on OPEN, and on server changes MERGE rather than replace: a
  // refetch (triggered by Add / Revert / Reset, or a window-focus refetch)
  // used to wipe every unsaved edit in the table.
  useEffect(() => {
    if (!open) return
    setRows((prev) => {
      const fresh = toDraft(effective)
      if (prev.length === 0) return fresh
      const byGroup = new Map(prev.map((r) => [r.group, r]))
      return fresh.map((f) => {
        const old = byGroup.get(f.group)
        // Keep the user's in-progress edits; take the new server baseline so
        // the row stops reading dirty once its value actually landed.
        return old && isDirty(old)
          ? { ...f, label: old.label, note: old.note, code: old.code, medicareRate: old.medicareRate }
          : f
      })
    })
  }, [open, effective])

  const dirtyRows = useMemo(() => rows.filter(isDirty), [rows])
  const overrideCount = overrides.length
  const busy =
    saveMutation.isPending || revertMutation.isPending || resetMutation.isPending

  const patchRow = (group: string, patch: Partial<DraftRow>) => {
    setRows((rs) => rs.map((r) => (r.group === group ? { ...r, ...patch } : r)))
  }

  const saveAll = () => {
    if (dirtyRows.length === 0) return
    saveMutation.mutate(
      dirtyRows.map((r) => ({
        group: r.group,
        label: r.label || undefined,
        code: r.code,
        medicareRate: r.medicareRate,
        note: r.note || undefined,
        // Only a changed RATE claims authority. Renaming a row or adding a
        // note must not paint the "Authoritative" badge on a built-in
        // placeholder — the badge is a trust signal, not an edit marker.
        rateEntered: r.medicareRate !== r.baseRate || r.source === "authoritative",
      })),
      { onSuccess: () => onRatesChanged?.() },
    )
  }

  const addCustom = () => {
    const group = newGroup.trim()
    const rate = Number(newRate)
    if (!group || !Number.isFinite(rate)) return
    if (effective.some((r) => r.group.toLowerCase() === group.toLowerCase())) {
      toast.error(`“${group}” is already in the table — edit that row instead.`)
      return
    }
    saveMutation.mutate(
      [{ group, code: newCode.trim() || "Custom", medicareRate: rate, rateEntered: true }],
      {
        onSuccess: () => {
          setNewGroup("")
          setNewCode("")
          setNewRate("")
          onRatesChanged?.()
        },
      },
    )
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2"
        onClick={() => setOpen(true)}
      >
        <SlidersHorizontal className="h-4 w-4" />
        Medicare rates
        {overrideCount > 0 ? (
          <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[10px]">
            {overrideCount}
          </Badge>
        ) : null}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[85vh] max-w-4xl flex-col gap-0 p-0">
          <DialogHeader className="p-6 pb-4">
            <DialogTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-muted-foreground" />
              Authoritative Medicare Rates
            </DialogTitle>
            <DialogDescription>
              Enter the authoritative CMS ASC allowable per case for each
              procedure group, and rename any rate&apos;s display name, code, or
              note. Saved values override the built-in national estimates
              everywhere in the analysis. Rows marked
              <span className="mx-1 font-medium text-foreground">Estimate</span>
              still use the built-in placeholder until you enter an
              authoritative figure.
            </DialogDescription>
          </DialogHeader>
          <Separator />

          <ScrollArea className="flex-1 overflow-y-auto">
            <div className="p-6 pt-4">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[38%]">Name &amp; note</TableHead>
                    <TableHead className="w-[16%]">CPT / HCPCS</TableHead>
                    <TableHead className="w-[18%]">Rate ($/case)</TableHead>
                    <TableHead className="w-[12%]">Source</TableHead>
                    <TableHead className="w-[16%] text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => {
                    const dirty = isDirty(r)
                    return (
                      <TableRow
                        key={r.group}
                        className={dirty ? "bg-emerald-600/5" : undefined}
                      >
                        <TableCell className="align-top">
                          <Input
                            value={r.label ?? ""}
                            placeholder={r.group}
                            onChange={(e) =>
                              patchRow(r.group, { label: e.target.value })
                            }
                            className="h-8 font-medium leading-tight"
                            aria-label={`Display name for ${r.group}`}
                          />
                          {(r.label ?? "") && r.label !== r.group ? (
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              matches: {r.group}
                            </span>
                          ) : null}
                          <Input
                            value={r.note ?? ""}
                            placeholder="Optional note (e.g. ASP-based drug)"
                            onChange={(e) =>
                              patchRow(r.group, { note: e.target.value })
                            }
                            aria-label={`Note for ${r.group}`}
                            className="mt-1.5 h-7 border-0 bg-transparent px-0 text-[11px] text-muted-foreground focus-visible:ring-0"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            value={r.code}
                            onChange={(e) =>
                              patchRow(r.group, { code: e.target.value })
                            }
                            aria-label={`CPT or HCPCS code for ${r.group}`}
                            className="h-8"
                          />
                        </TableCell>
                        <TableCell className="align-top">
                          <Input
                            type="number"
                            min={0}
                            value={r.medicareRate}
                            onChange={(e) =>
                              patchRow(r.group, {
                                medicareRate: Number(e.target.value) || 0,
                              })
                            }
                            aria-label={`Rate per case for ${r.group}`}
                            className="h-8 tabular-nums"
                          />
                          <span className="mt-1 block text-[11px] text-muted-foreground">
                            {formatCurrency(r.medicareRate)}
                          </span>
                        </TableCell>
                        <TableCell className="align-top">
                          {r.source === "authoritative" ? (
                            <Badge className="gap-1 bg-emerald-600 text-[10px] hover:bg-emerald-600">
                              <ShieldCheck className="h-3 w-3" />
                              Authoritative
                            </Badge>
                          ) : r.source === "uploaded" ? (
                            <Badge variant="secondary" className="text-[10px]">
                              Uploaded
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px]">
                              Estimate
                            </Badge>
                          )}
                          {r.medicareRate !== r.baseRate ? (
                            <span className="mt-1 block text-[10px] text-muted-foreground">
                              becomes authoritative on save
                            </span>
                          ) : null}
                        </TableCell>
                        <TableCell className="text-right align-top">
                          {r.source === "authoritative" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={busy}
                              className="h-8 gap-1 text-xs text-muted-foreground"
                              onClick={() =>
                                revertMutation.mutate(r.group, {
                                  onSuccess: () => onRatesChanged?.(),
                                })
                              }
                            >
                              <RotateCcw className="h-3 w-3" />
                              Revert
                            </Button>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>

              {/* Add a custom procedure group */}
              <div className="mt-6 rounded-md border border-dashed border-border p-4">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium">
                  <Plus className="h-4 w-4 text-muted-foreground" />
                  Add a custom procedure group
                </div>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label
                      htmlFor="new-rate-group"
                      className="text-[11px] text-muted-foreground"
                    >
                      Procedure group
                    </Label>
                    <Input
                      id="new-rate-group"
                      value={newGroup}
                      placeholder="e.g. Total Ankle Replacement"
                      onChange={(e) => setNewGroup(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="flex w-32 flex-col gap-1.5">
                    <Label
                      htmlFor="new-rate-code"
                      className="text-[11px] text-muted-foreground"
                    >
                      CPT / HCPCS
                    </Label>
                    <Input
                      id="new-rate-code"
                      value={newCode}
                      placeholder="CPT 27702"
                      onChange={(e) => setNewCode(e.target.value)}
                      className="h-8"
                    />
                  </div>
                  <div className="flex w-32 flex-col gap-1.5">
                    <Label
                      htmlFor="new-rate-value"
                      className="text-[11px] text-muted-foreground"
                    >
                      Rate ($/case)
                    </Label>
                    <Input
                      id="new-rate-value"
                      type="number"
                      min={0}
                      value={newRate}
                      placeholder="0"
                      onChange={(e) => setNewRate(e.target.value)}
                      className="h-8 tabular-nums"
                    />
                  </div>
                  <Button
                    size="sm"
                    className="h-8"
                    onClick={addCustom}
                    disabled={!newGroup.trim() || !newRate || busy}
                  >
                    Add
                  </Button>
                </div>
              </div>
            </div>
          </ScrollArea>

          <Separator />
          <DialogFooter className="flex-row items-center justify-between gap-2 p-4 sm:justify-between">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-muted-foreground"
              onClick={() =>
                resetMutation.mutate(undefined, {
                  onSuccess: () => onRatesChanged?.(),
                })
              }
              disabled={overrideCount === 0 || busy}
            >
              <RotateCcw className="h-4 w-4" />
              Reset all to defaults
            </Button>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {dirtyRows.length > 0
                  ? `${dirtyRows.length} unsaved`
                  : "All changes saved"}
              </span>
              <Button
                size="sm"
                onClick={saveAll}
                disabled={dirtyRows.length === 0 || busy}
                className="gap-2"
              >
                {saveMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Save changes
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
