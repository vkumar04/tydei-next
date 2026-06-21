"use client"

import { useState } from "react"
import { Plus, Trash2, Loader2 } from "lucide-react"
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
import { useToastMutation } from "@/hooks/use-toast-mutation"
import { queryKeys } from "@/lib/query-keys"
import { importCases } from "@/lib/actions/cases"
import type { CaseInput } from "@/lib/validators/cases"
import { formatCurrency, formatNumber } from "@/lib/formatting"

/** Max synthesized case rows across all entries — guards against a typo'd
 *  volume creating tens of thousands of rows. */
const MAX_CASES = 5_000

interface EntryRow {
  _uid: string
  cpt: string
  spendPerCase: string
  volume: string
}

function blankRow(): EntryRow {
  return { _uid: crypto.randomUUID(), cpt: "", spendPerCase: "", volume: "" }
}

/**
 * Manual case-cost entry (Vick 2026-06-21): instead of only uploading a file,
 * a facility can type CPT code + average spend per case + expected volume. Each
 * row expands into `volume` real Case rows (totalSpend = the per-case average,
 * primaryCptCode = the CPT) via the SAME `importCases` path as the upload, so it
 * flows into every case-costing report, facility averages, and Analysis.
 */
export function ManualCaseEntryDialog({
  facilityId,
  open,
  onOpenChange,
  onComplete,
}: {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}) {
  const [rows, setRows] = useState<EntryRow[]>([blankRow()])

  const parsed = rows.map((r) => ({
    cpt: r.cpt.trim(),
    spend: Number(r.spendPerCase.replace(/[^0-9.]/g, "")),
    volume: Math.floor(Number(r.volume.replace(/[^0-9]/g, ""))),
  }))
  const validRows = parsed.filter(
    (r) => r.cpt && r.spend > 0 && r.volume >= 1,
  )
  const totalCases = validRows.reduce((s, r) => s + r.volume, 0)
  const totalSpend = validRows.reduce((s, r) => s + r.spend * r.volume, 0)
  const overCap = totalCases > MAX_CASES

  const mutation = useToastMutation<CaseInput[], { imported: number }>(
    (cases) => importCases({ facilityId, cases }),
    {
      invalidate: [queryKeys.cases.all],
      success: (d) => `Created ${d.imported} case${d.imported === 1 ? "" : "s"}`,
      onSuccess: () => {
        setRows([blankRow()])
        onOpenChange(false)
        onComplete()
      },
    },
  )

  const setRow = (uid: string, patch: Partial<EntryRow>) =>
    setRows((rs) => rs.map((r) => (r._uid === uid ? { ...r, ...patch } : r)))

  function handleSubmit() {
    // Stamp a per-submit token so re-submits never collide on caseNumber.
    const token = crypto.randomUUID().slice(0, 8)
    const today = new Date().toISOString().slice(0, 10)
    const cases: CaseInput[] = []
    for (const r of validRows) {
      for (let i = 0; i < r.volume; i++) {
        cases.push({
          caseNumber: `MANUAL-${token}-${r.cpt}-${i + 1}`,
          dateOfSurgery: today,
          primaryCptCode: r.cpt,
          totalSpend: r.spend,
        })
      }
    }
    if (cases.length > 0) mutation.mutate(cases)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Manual case entry</DialogTitle>
          <DialogDescription>
            Enter a CPT code, the average supply spend per case, and the expected
            annual volume. Each row creates that many case records.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs font-medium text-muted-foreground">
            <span>CPT code</span>
            <span>Avg spend / case</span>
            <span>Expected volume</span>
            <span className="w-8" />
          </div>
          {rows.map((row) => (
            <div
              key={row._uid}
              className="grid grid-cols-[1fr_1fr_1fr_auto] items-center gap-2"
            >
              <Input
                placeholder="29881"
                value={row.cpt}
                onChange={(e) => setRow(row._uid, { cpt: e.target.value })}
              />
              <Input
                placeholder="$2,500"
                inputMode="decimal"
                value={row.spendPerCase}
                onChange={(e) =>
                  setRow(row._uid, { spendPerCase: e.target.value })
                }
              />
              <Input
                placeholder="200"
                inputMode="numeric"
                value={row.volume}
                onChange={(e) => setRow(row._uid, { volume: e.target.value })}
              />
              <Button
                variant="ghost"
                size="icon"
                aria-label="Remove row"
                disabled={rows.length === 1}
                onClick={() =>
                  setRows((rs) => rs.filter((r) => r._uid !== row._uid))
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ))}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setRows((rs) => [...rs, blankRow()])}
          >
            <Plus className="h-4 w-4" />
            Add row
          </Button>

          <div className="rounded-md bg-muted/40 px-3 py-2 text-sm">
            <Label className="text-muted-foreground">Will create </Label>
            <span className="font-semibold tabular-nums">
              {formatNumber(totalCases)} case{totalCases === 1 ? "" : "s"}
            </span>{" "}
            <span className="text-muted-foreground">
              · {formatCurrency(totalSpend)} total spend
            </span>
            {overCap ? (
              <p className="mt-1 text-xs text-destructive">
                Over the {formatNumber(MAX_CASES)}-case limit — reduce the
                expected volumes.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              validRows.length === 0 || overCap || mutation.isPending
            }
          >
            {mutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Create cases
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
