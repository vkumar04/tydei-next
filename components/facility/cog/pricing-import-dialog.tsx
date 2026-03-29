"use client"

import { useState } from "react"
import { Loader2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Progress } from "@/components/ui/progress"
import { FileDropzone } from "@/components/facility/cog/file-dropzone"
import { useFileParser } from "@/hooks/use-file-parser"
import { useImportPricingFiles } from "@/hooks/use-pricing-files"
import { useVendorList } from "@/hooks/use-vendor-crud"
import type { PricingFileInput } from "@/lib/validators/pricing-files"

interface PricingImportDialogProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function PricingImportDialog({
  facilityId,
  open,
  onOpenChange,
  onComplete,
}: PricingImportDialogProps) {
  const [vendorId, setVendorId] = useState("")
  const [result, setResult] = useState<{ imported: number; errors: number } | null>(null)
  const parser = useFileParser()
  const importMutation = useImportPricingFiles()
  const { data: vendorData } = useVendorList()

  const handleFile = async (file: File) => {
    await parser.parseFile(file)
  }

  const buildRecords = (): PricingFileInput[] => {
    if (!parser.data) return []
    return parser.data.rows.map((row) => ({
      vendorItemNo: row["vendorItemNo"] ?? row["Vendor Item No"] ?? row["Item No"] ?? "",
      productDescription: row["productDescription"] ?? row["Description"] ?? "",
      listPrice: parseFloat((row["listPrice"] ?? row["List Price"] ?? "0").replace(/[^0-9.-]/g, "")) || undefined,
      contractPrice: parseFloat((row["contractPrice"] ?? row["Contract Price"] ?? "0").replace(/[^0-9.-]/g, "")) || undefined,
      effectiveDate: row["effectiveDate"] ?? row["Effective Date"] ?? new Date().toISOString().slice(0, 10),
      expirationDate: row["expirationDate"] ?? row["Expiration Date"] ?? undefined,
      category: row["category"] ?? row["Category"] ?? undefined,
      uom: row["uom"] ?? row["UOM"] ?? "EA",
    })).filter((r) => r.vendorItemNo && r.productDescription)
  }

  const handleImport = async () => {
    const records = buildRecords()
    const res = await importMutation.mutateAsync({
      vendorId,
      facilityId,
      records,
    })
    setResult(res)
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setVendorId("")
      setResult(null)
      parser.reset()
      if (result) onComplete()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Import Pricing File</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Vendor</Label>
            <Select value={vendorId} onValueChange={setVendorId}>
              <SelectTrigger>
                <SelectValue placeholder="Select vendor..." />
              </SelectTrigger>
              <SelectContent>
                {vendorData?.vendors.map((v) => (
                  <SelectItem key={v.id} value={v.id}>
                    {v.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {vendorId && !parser.data && !result && (
            <FileDropzone
              accept={[".csv", ".xlsx", ".xls"]}
              onFile={handleFile}
              label="Upload vendor pricing file"
            />
          )}

          {parser.data && !result && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                {buildRecords().length} pricing entries found
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => parser.reset()}>
                  Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={importMutation.isPending || buildRecords().length === 0}
                >
                  {importMutation.isPending && <Loader2 className="animate-spin" />}
                  Import
                </Button>
              </div>
            </div>
          )}

          {importMutation.isPending && !result && (
            <Progress value={50} />
          )}

          {result && (
            <div className="space-y-3 py-2">
              <p className="font-medium">Import Complete</p>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-emerald-600">{result.imported}</p>
                  <p className="text-xs text-muted-foreground">Imported</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600">{result.errors}</p>
                  <p className="text-xs text-muted-foreground">Errors</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Button onClick={() => handleClose(false)}>Done</Button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
