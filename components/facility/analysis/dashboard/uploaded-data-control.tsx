"use client"

import { FileUp, X, Database } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { PricingFileDropzone } from "@/components/shared/uploads/pricing-file-dropzone"
import type {
  UploadFieldSpec,
  ResolvedMapping,
} from "@/components/shared/uploads/field-spec"
import {
  ITEM_NUMBER_ALIASES,
  UNIT_PRICE_ALIASES,
  CATEGORY_ALIASES,
} from "@/lib/utils/parse-pricing-file"
import {
  aggregateUploadedSpend,
  type UploadedSpendLine,
} from "@/lib/financial-analysis/uploaded-spend-to-analysis-data"
import type { FacilityAnalysisData } from "@/lib/actions/facility-analysis-data"

const VENDOR_ALIASES = [
  "vendor",
  "vendor_name",
  "supplier",
  "supplier_name",
  "manufacturer",
  "mfg",
  "mfr",
  "brand",
]
const QUANTITY_ALIASES = [
  "quantity",
  "qty",
  "annual_quantity",
  "annual_qty",
  "units",
  "unit_count",
  "volume",
  "annual_volume",
  "usage",
]
const SPEND_ALIASES = [
  "spend",
  "annual_spend",
  "total_spend",
  "extended_price",
  "extended_cost",
  "extendedprice",
  "ext_price",
  "total",
  "total_cost",
]

// Reuses the canonical header aliases (CLAUDE.md: never inline a header-alias
// list). category OR vendor + price OR spend are needed to model.
const SPEND_FILE_SPECS: UploadFieldSpec[] = [
  { key: "category", label: "Category", aliases: CATEGORY_ALIASES, kind: "text" },
  { key: "vendor", label: "Vendor", aliases: VENDOR_ALIASES, kind: "text" },
  { key: "unitPrice", label: "Unit price", aliases: UNIT_PRICE_ALIASES, kind: "number" },
  { key: "quantity", label: "Quantity", aliases: QUANTITY_ALIASES, kind: "number" },
  { key: "spend", label: "Extended / total spend", aliases: SPEND_ALIASES, kind: "number" },
  { key: "itemNumber", label: "Item number", aliases: ITEM_NUMBER_ALIASES, kind: "text" },
]

function parseNum(v: string | undefined): number | null {
  if (!v) return null
  const n = parseFloat(v.replace(/[^0-9.-]/g, "") || "")
  return Number.isFinite(n) ? n : null
}

export function UploadedDataControl({
  activeFileName,
  onApply,
  onReset,
}: {
  activeFileName: string | null
  onApply: (data: FacilityAnalysisData, fileName: string) => void
  onReset: () => void
}) {
  if (activeFileName) {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="secondary" className="gap-1.5">
          <FileUp className="h-3.5 w-3.5" />
          Modeling from {activeFileName}
        </Badge>
        <Button variant="ghost" size="sm" className="gap-1.5" onClick={onReset}>
          <Database className="h-3.5 w-3.5" />
          Reset to live COG
        </Button>
      </div>
    )
  }

  return (
    <PricingFileDropzone
      specs={SPEND_FILE_SPECS}
      surface="analysis-current-state"
      accept=".csv,.txt,.xlsx,.xls"
      trigger={
        <Button variant="outline" size="sm" className="gap-1.5">
          <FileUp className="h-4 w-4" />
          Model from uploaded file
        </Button>
      }
      triggerLabel="Model from uploaded file"
      triggerHint="Upload a pricing or spend file (category/vendor + price or spend) to drive Current State."
      validate={(m: ResolvedMapping) => {
        const hasGroup = Boolean(m.category || m.vendor)
        const hasValue = Boolean(m.spend || m.unitPrice)
        if (!hasGroup) return "Map a Category or Vendor column."
        if (!hasValue) return "Map a Unit price or Extended/total spend column."
        return null
      }}
      confirmCopy={(rows, m) => {
        const lines = projectLines(rows, m)
        const total = aggregateUploadedSpend(lines).currentVendorSpend
        return `${rows.length.toLocaleString()} rows · $${Math.round(
          total,
        ).toLocaleString()} total spend`
      }}
      onImport={(rows, mapping, meta) => {
        const data = aggregateUploadedSpend(projectLines(rows, mapping))
        onApply(data, meta.fileName)
      }}
    />
  )
}

function projectLines(
  rows: Record<string, string>[],
  m: ResolvedMapping,
): UploadedSpendLine[] {
  const col = (key: string) => m[key] ?? null
  const get = (row: Record<string, string>, key: string) => {
    const header = col(key)
    return header ? (row[header] ?? "") : ""
  }
  return rows.map((row) => ({
    category: get(row, "category") || null,
    vendor: get(row, "vendor") || null,
    unitPrice: parseNum(get(row, "unitPrice")),
    quantity: parseNum(get(row, "quantity")),
    spend: parseNum(get(row, "spend")),
  }))
}
