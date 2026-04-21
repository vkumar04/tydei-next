"use client"

import { useState, useMemo } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { ArrowRight, AlertCircle } from "lucide-react"

const TARGET_FIELDS = [
  { key: "vendorItemNo", label: "Vendor Item No", required: true },
  { key: "description", label: "Description", required: false },
  { key: "unitPrice", label: "Contract Price", required: true },
  { key: "listPrice", label: "List Price", required: false },
  { key: "category", label: "Category", required: false },
  { key: "uom", label: "UOM", required: false },
  // Charles iMessage 2026-04-20 N17: carve-out % per SKU, feeds the
  // CARVE_OUT rebate engine (lib/rebates/engine/carve-out.ts). Stored
  // on the PricingFile row as `carveOutPercent` (fraction).
  { key: "carveOutPercent", label: "Carve-Out %", required: false },
] as const

interface PricingColumnMapperProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  headers: string[]
  sampleRows: Record<string, string>[]
  autoMapping: Record<string, string>
  onApply: (mapping: Record<string, string>) => void
}

export function PricingColumnMapper({
  open,
  onOpenChange,
  headers,
  sampleRows,
  autoMapping,
  onApply,
}: PricingColumnMapperProps) {
  const [mapping, setMapping] = useState<Record<string, string>>(autoMapping)

  // Reset mapping when autoMapping changes (new file uploaded)
  const [prevAutoMapping, setPrevAutoMapping] = useState(autoMapping)
  if (autoMapping !== prevAutoMapping) {
    setPrevAutoMapping(autoMapping)
    setMapping(autoMapping)
  }

  const requiredMet = !!(mapping.vendorItemNo && mapping.unitPrice)

  // Get sample values for a given source column
  const getSampleValues = (sourceColumn: string): string[] => {
    if (!sourceColumn) return []
    return sampleRows
      .map((row) => row[sourceColumn] ?? "")
      .filter((v) => v !== "")
      .slice(0, 3)
  }

  // Category sample values when a category column is selected
  const categorySamples = useMemo(() => {
    const col = mapping.category
    if (!col) return []
    const unique = Array.from(
      new Set(sampleRows.map((r) => r[col] ?? "").filter(Boolean))
    )
    return unique.slice(0, 5)
  }, [mapping.category, sampleRows])

  function handleSelect(fieldKey: string, value: string) {
    setMapping((prev) => ({
      ...prev,
      [fieldKey]: value === "__none__" ? "" : value,
    }))
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Map Pricing File Columns</DialogTitle>
          <DialogDescription>
            We could not auto-detect all required columns. Please map your file
            columns to the expected fields below.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="flex-1 -mx-6 px-6">
          <div className="space-y-6 py-2">
            {/* Column mapping selects */}
            <div className="grid gap-4 sm:grid-cols-2">
              {TARGET_FIELDS.map((field) => {
                const samples = getSampleValues(mapping[field.key] ?? "")
                return (
                  <div key={field.key} className="space-y-1.5">
                    <Label className="text-sm font-medium">
                      {field.label}
                      {field.required && (
                        <span className="ml-0.5 text-destructive">*</span>
                      )}
                    </Label>
                    <Select
                      value={mapping[field.key] ?? ""}
                      onValueChange={(v) => handleSelect(field.key, v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select column..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">-- None --</SelectItem>
                        {headers.filter((h) => h !== "").map((h) => (
                          <SelectItem key={h} value={h}>
                            {h}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {samples.length > 0 && (
                      <p className="text-xs text-muted-foreground truncate">
                        e.g. {samples.join(", ")}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Category sample badges */}
            {categorySamples.length > 0 && (
              <div className="space-y-1.5">
                <Label className="text-sm font-medium">
                  Category values detected
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {categorySamples.map((c) => (
                    <Badge key={c} variant="secondary">
                      {c}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Sample data preview */}
            {sampleRows.length > 0 && (
              <div className="space-y-2">
                <Label className="text-sm font-medium">
                  File Preview (first {sampleRows.length} rows)
                </Label>
                <div className="rounded-md border overflow-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        {headers.map((h) => (
                          <TableHead
                            key={h}
                            className="whitespace-nowrap text-xs"
                          >
                            {h}
                          </TableHead>
                        ))}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sampleRows.slice(0, 3).map((row, i) => (
                        <TableRow key={i}>
                          {headers.map((h) => (
                            <TableCell
                              key={h}
                              className="whitespace-nowrap text-xs py-1.5"
                            >
                              {row[h] ?? ""}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {!requiredMet && (
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                <span>
                  Please map at least <strong>Vendor Item No</strong> and{" "}
                  <strong>Contract Price</strong> to continue.
                </span>
              </div>
            )}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Skip
          </Button>
          <Button
            disabled={!requiredMet}
            onClick={() => onApply(mapping)}
          >
            Apply Mapping
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
