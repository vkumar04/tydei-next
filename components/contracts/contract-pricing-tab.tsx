"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload, Loader2, Download } from "lucide-react"
import { toast } from "sonner"
import {
  getContractPricing,
  importContractPricing,
  type ContractPricingItem,
} from "@/lib/actions/pricing-files"
import {
  parsePricingFile,
  buildPricingItems,
} from "@/lib/utils/parse-pricing-file"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCurrency } from "@/lib/formatting"
import { PricingColumnMapper } from "@/components/contracts/pricing-column-mapper"

interface ContractPricingTabProps {
  contractId: string
  vendorId: string
}

export function ContractPricingTab({
  contractId,
}: ContractPricingTabProps) {
  const queryClient = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)

  // Column-mapper fallback state (mirrors new-contract-client.tsx)
  const [mapperOpen, setMapperOpen] = useState(false)
  const [rawHeaders, setRawHeaders] = useState<string[]>([])
  const [rawRows, setRawRows] = useState<Record<string, string>[]>([])
  const [autoMapping, setAutoMapping] = useState<Record<string, string>>({})
  const [pendingFileName, setPendingFileName] = useState<string | null>(null)

  const pricingQueryKey = ["contract-pricing", contractId] as const
  const { data: pricing, isLoading } = useQuery({
    queryKey: pricingQueryKey,
    queryFn: () => getContractPricing(contractId),
  })

  async function importItems(items: ContractPricingItem[]) {
    const result = await importContractPricing({
      contractId,
      items,
    })
    toast.success(`Imported ${result.imported} pricing records`)
    await queryClient.invalidateQueries({ queryKey: pricingQueryKey })
  }

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const parsed = await parsePricingFile(file)
      if (parsed.needsManualMapping) {
        // Open the column mapper dialog so the user can map columns manually.
        setRawHeaders(parsed.rawHeaders)
        setRawRows(parsed.rawRows)
        setAutoMapping(parsed.autoMapping)
        setPendingFileName(file.name)
        setMapperOpen(true)
        return
      }
      if (parsed.items.length === 0) {
        toast.error(
          "No valid pricing items found. Check your file has columns like vendor_item_no and contract_price.",
        )
        return
      }
      await importItems(parsed.items)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload pricing file",
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleMappingApply(mapping: Record<string, string>) {
    setMapperOpen(false)
    setUploading(true)
    try {
      const dataRows = rawRows.map((row) =>
        rawHeaders.map((h) => row[h] ?? ""),
      )
      const items = buildPricingItems(dataRows, rawHeaders, mapping)
      if (items.length === 0) {
        toast.error("No valid pricing items found with the selected mapping.")
        return
      }
      await importItems(items)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to import pricing file",
      )
    } finally {
      setUploading(false)
      setPendingFileName(null)
      setRawHeaders([])
      setRawRows([])
      setAutoMapping({})
    }
  }

  const rows = useMemo(() => pricing ?? [], [pricing])

  // Client-side pagination. Default 50/page; pricing files routinely
  // run into the thousands and rendering all rows tanks the page.
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  // Reset to page 1 when the underlying data changes (e.g. after import).
  useEffect(() => {
    setPage(1)
  }, [rows.length])
  const safePage = Math.min(page, pageCount)
  const pagedRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage],
  )

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Contract Pricing</CardTitle>
          <CardDescription>
            Pricing items attached to this contract
            {pendingFileName ? ` — mapping ${pendingFileName}` : ""}
          </CardDescription>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => {
              window.location.href = `/api/contracts/${contractId}/pricing/export`
            }}
            disabled={rows.length === 0}
          >
            <Download className="mr-2 h-4 w-4" />
            Export CSV
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleFile(file)
            }}
          />
          <Button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            Upload Pricing File
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
        ) : rows.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">
            No pricing attached yet. Upload a CSV or Excel file above to get
            started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Vendor Item No</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="text-right">List Price</TableHead>
                <TableHead className="text-right">Contract Price</TableHead>
                <TableHead>UOM</TableHead>
                <TableHead>Category</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pagedRows.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-mono text-xs">
                    {r.vendorItemNo}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate">
                    {r.description ?? "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    {r.listPrice != null
                      ? formatCurrency(Number(r.listPrice))
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right font-medium">
                    {formatCurrency(Number(r.unitPrice))}
                  </TableCell>
                  <TableCell>{r.uom}</TableCell>
                  <TableCell>{r.category ?? "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {rows.length > PAGE_SIZE ? (
          <div className="mt-4 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Showing{" "}
              <span className="font-medium text-foreground">
                {(safePage - 1) * PAGE_SIZE + 1}
                –
                {Math.min(safePage * PAGE_SIZE, rows.length)}
              </span>{" "}
              of{" "}
              <span className="font-medium text-foreground">
                {rows.length.toLocaleString()}
              </span>{" "}
              rows
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {safePage} of {pageCount}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                disabled={safePage >= pageCount}
              >
                Next
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>

      <PricingColumnMapper
        open={mapperOpen}
        onOpenChange={(o) => {
          setMapperOpen(o)
          if (!o) {
            // User cancelled — clear pending file state.
            setUploading(false)
            setPendingFileName(null)
          }
        }}
        headers={rawHeaders}
        sampleRows={rawRows}
        autoMapping={autoMapping}
        onApply={handleMappingApply}
      />
    </Card>
  )
}
