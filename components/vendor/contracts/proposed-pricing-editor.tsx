"use client"

import { useMemo, useRef, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Plus, Trash2, Upload, Loader2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from "sonner"
import { queryKeys } from "@/lib/query-keys"
import { formatCurrency } from "@/lib/formatting"
import { getVendorContractPricing } from "@/lib/actions/pricing-files"
import { parsePricingFile } from "@/lib/utils/parse-pricing-file"
import {
  matchProposedPricing,
  summarizePricingMatch,
  type ProposedPricingItem,
} from "@/lib/contracts/pricing-match"

interface Row extends ProposedPricingItem {
  id: string
}

let seq = 0
const blank = (patch: Partial<Row> = {}): Row => ({
  id: `p-${seq++}`,
  vendorItemNo: "",
  description: "",
  category: "",
  unitPrice: 0,
  ...patch,
})

/**
 * Lets a vendor propose pricing alongside a change proposal, matched live
 * against what the contract already carries so each row reads as a new SKU or a
 * reprice rather than an opaque replacement.
 *
 * The classification shown here is the SAME `matchProposedPricing` the facility
 * runs on approve, so the reviewer cannot see a different diff than the vendor
 * submitted.
 */
export function ProposedPricingEditor({
  contractId,
  items,
  onChange,
}: {
  contractId: string
  items: ProposedPricingItem[]
  onChange: (items: ProposedPricingItem[]) => void
}) {
  const [rows, setRows] = useState<Row[]>(() => items.map((i) => blank(i)))
  const [parsing, setParsing] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: existing = [] } = useQuery({
    queryKey: queryKeys.contracts.vendorPricing(contractId),
    queryFn: () => getVendorContractPricing(contractId),
  })

  const push = (next: Row[]) => {
    setRows(next)
    onChange(
      next
        .filter((r) => r.vendorItemNo.trim().length > 0)
        .map(({ vendorItemNo, description, category, unitPrice, uom }) => ({
          vendorItemNo,
          description,
          category,
          unitPrice,
          uom,
        })),
    )
  }

  const match = useMemo(
    () =>
      matchProposedPricing(
        rows.filter((r) => r.vendorItemNo.trim().length > 0),
        existing.map((e) => ({
          id: e.id,
          vendorItemNo: e.vendorItemNo,
          description: e.description,
          category: e.category,
          unitPrice: e.unitPrice,
        })),
      ),
    [rows, existing],
  )

  const kindOf = (vendorItemNo: string) =>
    match.changes.find((c) => c.item.vendorItemNo === vendorItemNo) ?? null

  async function handleFile(file: File) {
    setParsing(true)
    try {
      const parsed = await parsePricingFile(file)
      const built = parsed.items
      if (parsed.needsManualMapping || built.length === 0) {
        toast.error(
          "Could not read an item number and price from that file — check the column headers",
        )
        return
      }
      push([
        ...rows.filter((r) => r.vendorItemNo.trim().length > 0),
        ...built.map((b) =>
          blank({
            vendorItemNo: b.vendorItemNo,
            description: b.description ?? "",
            category: b.category ?? "",
            unitPrice: b.unitPrice,
            uom: b.uom,
          }),
        ),
      ])
      toast.success(`Loaded ${built.length} pricing rows`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not read that file")
    } finally {
      setParsing(false)
      if (fileRef.current) fileRef.current.value = ""
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-sm font-medium">Proposed pricing</h4>
          <p className="text-[11px] text-muted-foreground">
            Matched against this contract&apos;s current pricing by item number.
            {match.changes.length > 0 ? ` ${summarizePricingMatch(match)}.` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void handleFile(f)
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={parsing}
            onClick={() => fileRef.current?.click()}
          >
            {parsing ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Upload className="size-3.5" />
            )}
            Upload price file
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => push([...rows, blank()])}
          >
            <Plus className="size-3.5" /> Add item
          </Button>
        </div>
      </div>

      {match.duplicateSkus.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">
          Duplicate item numbers — only the last row for each would apply:{" "}
          {match.duplicateSkus.slice(0, 5).join(", ")}
          {match.duplicateSkus.length > 5 ? "…" : ""}
        </p>
      )}

      {rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-[11px] text-muted-foreground">
          No pricing proposed. Upload a price file or add items to propose new
          SKUs or new prices for existing ones.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item #</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">Current</TableHead>
                <TableHead className="text-right">Proposed</TableHead>
                <TableHead>Change</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const c = kindOf(row.vendorItemNo)
                return (
                  <TableRow key={row.id}>
                    <TableCell className="min-w-[9rem]">
                      <Input
                        value={row.vendorItemNo}
                        placeholder="SKU"
                        onChange={(e) =>
                          push(
                            rows.map((r) =>
                              r.id === row.id
                                ? { ...r, vendorItemNo: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="min-w-[12rem]">
                      <Input
                        value={row.description ?? ""}
                        placeholder="Description"
                        onChange={(e) =>
                          push(
                            rows.map((r) =>
                              r.id === row.id
                                ? { ...r, description: e.target.value }
                                : r,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums text-muted-foreground">
                      {c?.oldPrice != null ? formatCurrency(c.oldPrice) : "—"}
                    </TableCell>
                    <TableCell className="min-w-[7rem]">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        value={row.unitPrice}
                        onChange={(e) =>
                          push(
                            rows.map((r) =>
                              r.id === row.id
                                ? { ...r, unitPrice: Number(e.target.value) }
                                : r,
                            ),
                          )
                        }
                      />
                    </TableCell>
                    <TableCell>
                      {!c || !row.vendorItemNo.trim() ? null : c.kind === "add" ? (
                        <Badge
                          variant="outline"
                          className="border-emerald-600/40 text-emerald-600 dark:text-emerald-400"
                        >
                          New
                        </Badge>
                      ) : c.kind === "update" ? (
                        <Badge
                          variant="outline"
                          className="border-amber-600/40 text-amber-600 dark:text-amber-400"
                        >
                          {c.delta != null && c.delta > 0 ? "+" : ""}
                          {c.delta != null ? formatCurrency(c.delta) : ""}
                          {c.deltaPercent != null
                            ? ` (${(c.deltaPercent * 100).toFixed(1)}%)`
                            : ""}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">
                          Unchanged
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        onClick={() => push(rows.filter((r) => r.id !== row.id))}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}
