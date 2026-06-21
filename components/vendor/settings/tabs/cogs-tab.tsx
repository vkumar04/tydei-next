"use client"

import { useCallback, useRef } from "react"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Boxes, Loader2, Lock, RefreshCw, Upload } from "lucide-react"
import { formatCurrency, formatDate } from "@/lib/formatting"
import {
  useImportVendorCog,
  useRecomputeVendorCog,
  useVendorCogRecords,
  useVendorCogStats,
} from "@/hooks/use-vendor-cog"
import {
  PricingFileDropzone,
  type PricingFileDropzoneHandle,
} from "@/components/shared/uploads/pricing-file-dropzone"
import type {
  ResolvedMapping,
  UploadFieldSpec,
} from "@/components/shared/uploads/field-spec"
import {
  ITEM_NUMBER_ALIASES,
  DESCRIPTION_ALIASES,
  UNIT_PRICE_ALIASES,
  CATEGORY_ALIASES,
} from "@/lib/utils/parse-pricing-file"

// Field specs for the shared <PricingFileDropzone>. Built from the canonical
// header-alias lists (invariants table: "Pricing-file header detection") plus
// vendor-COG-only extras — NEVER inline a copy of the canonical aliases.
const VENDOR_COG_UPLOAD_SPECS: UploadFieldSpec[] = [
  {
    key: "inventoryNumber",
    label: "Item / SKU number",
    aliases: ITEM_NUMBER_ALIASES,
    required: true,
    kind: "text",
  },
  {
    key: "description",
    label: "Description",
    aliases: DESCRIPTION_ALIASES,
    kind: "text",
  },
  {
    key: "vendorItemNo",
    label: "Vendor item number",
    aliases: ["vendor_item_no", "vendoritemno", "vendoritem", ...ITEM_NUMBER_ALIASES],
    kind: "text",
  },
  {
    key: "manufacturerNo",
    label: "Manufacturer number",
    aliases: [
      "manufacturer_no",
      "manufacturerno",
      "mfg_no",
      "mfgno",
      "mfr_no",
      "mfrno",
      "manufacturernumber",
    ],
    kind: "text",
  },
  {
    key: "unitCost",
    label: "Unit cost",
    aliases: UNIT_PRICE_ALIASES,
    required: true,
    kind: "number",
  },
  {
    key: "extendedPrice",
    label: "Extended cost",
    aliases: [
      "extended_price",
      "extendedprice",
      "extended_cost",
      "extendedcost",
      "extended",
      "line_total",
      "linetotal",
      "total_cost",
      "totalcost",
    ],
    kind: "number",
  },
  {
    key: "quantity",
    label: "Quantity",
    aliases: ["quantity", "qty", "units", "unitsordered", "qtyordered"],
    kind: "number",
  },
  {
    key: "poNumber",
    label: "Purchase order number",
    aliases: ["po_number", "ponumber", "po_no", "pono", "po", "purchaseorder"],
    kind: "text",
  },
  {
    key: "category",
    label: "Category",
    aliases: CATEGORY_ALIASES,
    kind: "text",
  },
  {
    key: "transactionDate",
    label: "Transaction date",
    aliases: [
      "transaction_date",
      "transactiondate",
      "date",
      "dateordered",
      "orderdate",
      "invoicedate",
      "invoice_date",
    ],
    required: true,
    kind: "date",
  },
]

export interface CogsTabProps {
  vendorId: string
  /**
   * Vendor COGS is only meaningful in 1-way mode (the vendor owns the COG
   * data). The parent decides; this tab renders an explanatory empty state
   * when not enabled.
   */
  isOneWay: boolean
  /**
   * Active division to stamp imported rows with (hard isolation). Null =
   * vendor-wide. The parent passes the division switcher's selection.
   */
  activeDivisionId?: string | null
}

export function CogsTab({ vendorId, isOneWay, activeDivisionId }: CogsTabProps) {
  const dropzoneRef = useRef<PricingFileDropzoneHandle>(null)
  const { data: records, isLoading } = useVendorCogRecords(vendorId)
  const { data: stats } = useVendorCogStats(vendorId)
  const importMutation = useImportVendorCog(vendorId)
  const recomputeMutation = useRecomputeVendorCog(vendorId)

  const handleImport = useCallback(
    async (
      rows: Record<string, string>[],
      mapping: ResolvedMapping,
      meta: { fileName: string; headers: string[] },
    ) => {
      // Pass the user-confirmed dropzone mapping straight to the server
      // action — it resolves columns through the shared field-spec resolver.
      await importMutation.mutateAsync({
        rows,
        opts: {
          mapping,
          vendorDivisionId: activeDivisionId ?? null,
          fileName: meta.fileName,
        },
      })
    },
    [importMutation, activeDivisionId],
  )

  if (!isOneWay) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Cost of Goods (COGS)
          </CardTitle>
          <CardDescription>
            Vendor-owned COGS is only available in 1-way mode.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="py-10 text-center">
            <Boxes className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">
              COGS upload is disabled
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              In 2-way mode the facility owns its purchase data. Switch to
              1-way mode to enter and manage your own cost-of-goods records
              here.
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const busy = importMutation.isPending

  const importButton = (
    <Button variant="outline" size="sm" disabled={busy}>
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Upload className="h-4 w-4" />
      )}
      Import COGS
    </Button>
  )

  return (
    <div className="space-y-6">
      {/* Stats summary */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total COG Records</CardDescription>
            <CardTitle className="text-3xl">
              {(stats?.totalRecords ?? 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {stats?.latestTransactionDate
                ? `Latest: ${formatDate(stats.latestTransactionDate)}`
                : "No records yet"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Spend</CardDescription>
            <CardTitle className="text-3xl">
              {formatCurrency(stats?.totalSpend ?? 0)}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              {(stats?.categoryCount ?? 0).toLocaleString()} categor
              {(stats?.categoryCount ?? 0) === 1 ? "y" : "ies"}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>On Contract</CardDescription>
            <CardTitle className="text-3xl text-primary">
              {(stats?.onContractCount ?? 0).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Rows matched to a contract
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Records table + upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Boxes className="h-5 w-5" />
            Cost of Goods (COGS)
          </CardTitle>
          <CardDescription>
            Upload your own cost-of-goods records (CSV or Excel). Rows are
            stored privately to your organization and scoped to your active
            division.
          </CardDescription>
          <CardAction className="flex items-center gap-2">
            {/* Re-match existing COG against the vendor's own contracts so
                "On Contract" populates for rows imported before the matcher. */}
            <Button
              variant="outline"
              size="sm"
              disabled={busy || recomputeMutation.isPending}
              onClick={() => recomputeMutation.mutate()}
            >
              {recomputeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Recompute matches
            </Button>
            <PricingFileDropzone
              ref={dropzoneRef}
              specs={VENDOR_COG_UPLOAD_SPECS}
              surface="vendor-cogs"
              accept=".csv,.xlsx,.xls"
              trigger={importButton}
              onImport={handleImport}
              disabled={busy}
            />
          </CardAction>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-12 rounded-md" />
              ))}
            </div>
          ) : !records || records.length === 0 ? (
            <div className="py-12 text-center">
              <Boxes className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
              <p className="font-medium text-muted-foreground">
                No COG records yet
              </p>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Import a CSV or Excel file with your item numbers, unit costs
                and transaction dates to get started.
              </p>
              <div className="mt-4 flex justify-center">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => dropzoneRef.current?.openFilePicker()}
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Upload className="h-4 w-4" />
                  )}
                  Import COGS
                </Button>
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-md border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Item</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Cost</TableHead>
                      <TableHead className="text-right">Extended</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {records.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{row.inventoryNumber}</p>
                            <p className="text-xs text-muted-foreground">
                              {row.inventoryDescription}
                            </p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {row.category ? (
                            <Badge variant="outline">{row.category}</Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.quantity.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.unitCost)}
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {row.extendedPrice != null
                            ? formatCurrency(row.extendedPrice)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(row.transactionDate)}
                        </TableCell>
                        <TableCell>
                          {row.isOnContract ? (
                            <Badge>On contract</Badge>
                          ) : (
                            <Badge variant="secondary">Off contract</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex items-center justify-between border-t pt-4 text-sm text-muted-foreground">
                <span>Showing {records.length} most recent rows</span>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
