"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { mergeCategories } from "@/lib/actions/categories/merge"
import type { CategoryUsageRow } from "@/lib/actions/categories/types"
import { formatCurrency } from "@/lib/formatting"
import { toast } from "sonner"
import { useRouter } from "next/navigation"

export function CategoryMergeClient({
  initialUsage,
}: {
  initialUsage: CategoryUsageRow[]
}) {
  const router = useRouter()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [canonical, setCanonical] = useState("")
  const [open, setOpen] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Group by canonical for "potential duplicate" hints.
  const canonicalGroups = new Map<string, CategoryUsageRow[]>()
  for (const row of initialUsage) {
    const key = row.canonical
    if (!canonicalGroups.has(key)) canonicalGroups.set(key, [])
    canonicalGroups.get(key)!.push(row)
  }

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(name)) next.delete(name)
      else next.add(name)
      return next
    })
  }

  function openMergeDialog() {
    if (selected.size < 2) {
      toast.error("Select at least 2 categories to merge")
      return
    }
    // Default canonical name to the highest-spend selected category.
    const ranked = initialUsage
      .filter((r) => selected.has(r.name))
      .sort((a, b) => b.cogSpend - a.cogSpend)
    setCanonical(ranked[0]?.name ?? "")
    setOpen(true)
  }

  function doMerge() {
    if (!canonical.trim()) {
      toast.error("Canonical name cannot be empty")
      return
    }
    const aliases = Array.from(selected)
    startTransition(async () => {
      try {
        const result = await mergeCategories({
          canonicalName: canonical.trim(),
          aliasNames: aliases,
        })
        toast.success(
          `Merged ${result.aliasesMerged.length} categories into "${result.canonicalName}". Updated ${result.cogRowsUpdated + result.pricingRowsUpdated + result.pricingFileRowsUpdated} rows.`,
        )
        setSelected(new Set())
        setCanonical("")
        setOpen(false)
        router.refresh()
      } catch (err) {
        toast.error(
          err instanceof Error ? err.message : "Failed to merge categories",
        )
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Categories in your data</CardTitle>
        <CardDescription>
          {initialUsage.length} distinct category labels across your COG
          records, contract pricing, and uploaded pricing files. Rows sharing a
          canonical form are highlighted with a yellow badge — likely candidates
          for merging.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-2">
          <Button
            type="button"
            onClick={openMergeDialog}
            disabled={selected.size < 2 || isPending}
          >
            Merge {selected.size} selected
          </Button>
          {selected.size > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => setSelected(new Set())}
            >
              Clear selection
            </Button>
          )}
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-12"></TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="text-right">COG rows</TableHead>
              <TableHead className="text-right">COG spend</TableHead>
              <TableHead className="text-right">Pricing rows</TableHead>
              <TableHead>Likely duplicate of</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {initialUsage.map((row) => {
              const group = canonicalGroups.get(row.canonical) ?? []
              const dupes = group.filter((g) => g.name !== row.name)
              return (
                <TableRow key={row.name}>
                  <TableCell>
                    <Checkbox
                      checked={selected.has(row.name)}
                      onCheckedChange={() => toggle(row.name)}
                      aria-label={`Select ${row.name}`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{row.name}</TableCell>
                  <TableCell className="text-right">{row.cogCount}</TableCell>
                  <TableCell className="text-right">
                    {formatCurrency(row.cogSpend)}
                  </TableCell>
                  <TableCell className="text-right">
                    {row.pricingCount}
                  </TableCell>
                  <TableCell>
                    {dupes.length > 0 ? (
                      <Badge
                        variant="outline"
                        className="border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:text-amber-200"
                      >
                        {dupes.map((d) => d.name).join(", ")}
                      </Badge>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Merge categories</DialogTitle>
            <DialogDescription>
              All selected categories will be renamed to the canonical name.
              This update is applied across COG, ContractPricing, and
              PricingFile rows. The change is irreversible without a manual
              re-rename.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <label className="text-sm font-medium" htmlFor="canonical-name">
                Canonical name
              </label>
              <Input
                id="canonical-name"
                value={canonical}
                onChange={(e) => setCanonical(e.target.value)}
                placeholder="e.g. Total Joint"
              />
            </div>
            <div className="text-xs text-muted-foreground">
              <div className="font-semibold mb-1">Will rename:</div>
              <ul className="list-inside list-disc">
                {Array.from(selected).map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setOpen(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={doMerge}
              disabled={isPending || !canonical.trim()}
            >
              {isPending ? "Merging…" : "Merge"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
