"use client"

import { useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload, Loader2 } from "lucide-react"
import { toast } from "sonner"
import {
  getContractPricing,
  importContractPricing,
} from "@/lib/actions/pricing-files"
import { parsePricingFile } from "@/lib/utils/parse-pricing-file"
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

  const pricingQueryKey = ["contract-pricing", contractId] as const
  const { data: pricing, isLoading } = useQuery({
    queryKey: pricingQueryKey,
    queryFn: () => getContractPricing(contractId),
  })

  async function handleFile(file: File) {
    setUploading(true)
    try {
      const parsed = await parsePricingFile(file)
      if (parsed.needsManualMapping || parsed.items.length === 0) {
        toast.error(
          "Could not auto-detect columns. Please upload a file with vendor_item_no and contract_price columns, or use the New Contract flow for manual mapping.",
        )
        return
      }
      const result = await importContractPricing({
        contractId,
        items: parsed.items,
      })
      toast.success(`Imported ${result.imported} pricing records`)
      await queryClient.invalidateQueries({ queryKey: pricingQueryKey })
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to upload pricing file",
      )
    } finally {
      setUploading(false)
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  const rows = pricing ?? []

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Contract Pricing</CardTitle>
          <CardDescription>
            Pricing items attached to this contract
          </CardDescription>
        </div>
        <div>
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
              {rows.map((r) => (
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
      </CardContent>
    </Card>
  )
}
