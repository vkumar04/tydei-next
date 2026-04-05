"use client"

import { useState, useEffect, useRef } from "react"
import { Loader2, Sparkles } from "lucide-react"
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
import { COGColumnMapper } from "@/components/facility/cog/cog-column-mapper"
import { useFileParser } from "@/hooks/use-file-parser"
import { usePricingImport } from "@/hooks/use-pricing-import"
import { useImportPricingFiles } from "@/hooks/use-pricing-files"
import { useVendorList } from "@/hooks/use-vendor-crud"

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
  const [result, setResult] = useState<{
    imported: number
    errors: number
  } | null>(null)
  const parser = useFileParser()
  const importState = usePricingImport()
  const importMutation = useImportPricingFiles()
  const { data: vendorData } = useVendorList()
  const forwarded = useRef(false)

  const handleFile = async (file: File) => {
    forwarded.current = false
    await parser.parseFile(file)
  }

  // Forward parsed data to import state for AI mapping
  useEffect(() => {
    if (parser.data && importState.step === "upload" && !forwarded.current) {
      forwarded.current = true
      importState.setParsedData(parser.data.headers, parser.data.rows)
    }
  }, [parser.data, importState])

  const handleImport = async () => {
    importState.setStep("import")
    try {
      const res = await importMutation.mutateAsync({
        vendorId,
        facilityId,
        records: importState.mappedRecords,
      })
      setResult(res)
    } catch {
      importState.setStep("preview")
    }
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      setVendorId("")
      setResult(null)
      parser.reset()
      importState.reset()
      forwarded.current = false
      if (result) onComplete()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Pricing File</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {/* Step 1: Vendor selection */}
          {!vendorId && (
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
          )}

          {/* Step 2: File upload */}
          {vendorId && importState.step === "upload" && !result && (
            <FileDropzone
              accept={[".csv", ".xlsx", ".xls"]}
              onFile={handleFile}
              label="Upload vendor pricing file"
            />
          )}

          {/* Step 3: AI mapping in progress */}
          {importState.step === "mapping" && (
            <div className="space-y-3 py-4 text-center">
              <Sparkles className="mx-auto h-8 w-8 animate-pulse text-primary" />
              <p className="text-sm text-muted-foreground">
                AI is mapping your columns...
              </p>
              <Progress value={50} />
            </div>
          )}

          {/* Step 4: Column mapping review */}
          {importState.step === "map" && (
            <div className="space-y-4">
              <COGColumnMapper
                sourceColumns={importState.headers}
                targetFields={importState.targetFields}
                mapping={importState.mapping}
                onChange={importState.setMapping}
              />
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    forwarded.current = false
                    parser.reset()
                    importState.setStep("upload")
                  }}
                >
                  Back
                </Button>
                <Button onClick={importState.goToDuplicateCheck}>Preview</Button>
              </div>
            </div>
          )}

          {/* Step 5: Duplicate check */}
          {importState.step === "duplicate_check" && (
            <div className="space-y-4">
              <div className="rounded-md border p-4">
                {importState.duplicates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No duplicate vendor item numbers found in the import file.
                  </p>
                ) : (
                  <>
                    <p className="text-sm font-medium text-amber-600 dark:text-amber-400">
                      {importState.duplicates.length} duplicate vendor item
                      {importState.duplicates.length === 1 ? " number" : " numbers"}{" "}
                      found ({importState.duplicates.reduce((sum, d) => sum + d.count, 0)}{" "}
                      total rows)
                    </p>
                    <div className="mt-3 max-h-40 overflow-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-1 pr-3">Vendor Item No</th>
                            <th className="pb-1">Occurrences</th>
                          </tr>
                        </thead>
                        <tbody>
                          {importState.duplicates.slice(0, 20).map((d) => (
                            <tr key={d.vendorItemNo} className="border-b last:border-0">
                              <td className="py-1 pr-3 font-mono">{d.vendorItemNo}</td>
                              <td className="py-1">{d.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {importState.duplicates.length > 20 && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          ...and {importState.duplicates.length - 20} more
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => importState.setStep("map")}
                >
                  Back
                </Button>
                <Button onClick={importState.goToPreview}>
                  {importState.duplicates.length > 0
                    ? "Proceed Anyway"
                    : "Continue"}
                </Button>
              </div>
            </div>
          )}

          {/* Step 6: Preview */}
          {importState.step === "preview" && (
            <div className="space-y-4">
              <div className="rounded-md border p-4">
                <p className="text-sm font-medium">
                  {importState.mappedRecords.length} pricing entries ready to
                  import
                </p>
                {importState.mappedRecords.length > 0 && (
                  <div className="mt-3 max-h-48 overflow-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="pb-1 pr-3">Item No</th>
                          <th className="pb-1 pr-3">Description</th>
                          <th className="pb-1 pr-3">Contract Price</th>
                          <th className="pb-1">UOM</th>
                        </tr>
                      </thead>
                      <tbody>
                        {importState.mappedRecords.slice(0, 10).map((r, i) => (
                          <tr key={i} className="border-b last:border-0">
                            <td className="py-1 pr-3 font-mono">
                              {r.vendorItemNo}
                            </td>
                            <td className="py-1 pr-3 max-w-[200px] truncate">
                              {r.productDescription}
                            </td>
                            <td className="py-1 pr-3">
                              {r.contractPrice != null
                                ? `$${r.contractPrice.toFixed(2)}`
                                : "—"}
                            </td>
                            <td className="py-1">{r.uom}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {importState.mappedRecords.length > 10 && (
                      <p className="mt-2 text-xs text-muted-foreground">
                        ...and {importState.mappedRecords.length - 10} more
                      </p>
                    )}
                  </div>
                )}
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => importState.setStep("duplicate_check")}
                >
                  Back
                </Button>
                <Button
                  onClick={handleImport}
                  disabled={
                    importMutation.isPending ||
                    importState.mappedRecords.length === 0
                  }
                >
                  {importMutation.isPending && (
                    <Loader2 className="animate-spin" />
                  )}
                  Import {importState.mappedRecords.length} Entries
                </Button>
              </div>
            </div>
          )}

          {/* Step 7: Importing */}
          {importState.step === "import" && !result && (
            <div className="space-y-3 py-4">
              <p className="text-sm text-muted-foreground">
                Importing records...
              </p>
              <Progress value={50} />
            </div>
          )}

          {/* Step 8: Result */}
          {result && (
            <div className="space-y-3 py-2">
              <p className="font-medium">Import Complete</p>
              <div className="grid grid-cols-2 gap-4 text-center">
                <div>
                  <p className="text-2xl font-bold text-emerald-600">
                    {result.imported}
                  </p>
                  <p className="text-xs text-muted-foreground">Imported</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                    {result.errors}
                  </p>
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
