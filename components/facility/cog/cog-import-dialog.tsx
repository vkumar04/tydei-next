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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { FileDropzone } from "@/components/facility/cog/file-dropzone"
import { COGColumnMapper } from "@/components/facility/cog/cog-column-mapper"
import { COGImportPreview } from "@/components/facility/cog/cog-import-preview"
import { useCOGImport } from "@/hooks/use-cog-import"
import { useFileParser } from "@/hooks/use-file-parser"
import { useImportCOGRecords } from "@/hooks/use-cog"

interface COGImportDialogProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function COGImportDialog({
  facilityId,
  open,
  onOpenChange,
  onComplete,
}: COGImportDialogProps) {
  const parser = useFileParser()
  const importState = useCOGImport()
  const importMutation = useImportCOGRecords()
  const [result, setResult] = useState<{
    imported: number
    skipped: number
    errors: number
  } | null>(null)

  const handleFile = async (file: File) => {
    await parser.parseFile(file)
    if (parser.data) {
      importState.setParsedData(parser.data.headers, parser.data.rows)
    }
  }

  // After parsing finishes, push data into import state
  if (parser.data && importState.step === "upload") {
    importState.setParsedData(parser.data.headers, parser.data.rows)
  }

  const handleImport = async () => {
    importState.setStep("import")
    const res = await importMutation.mutateAsync({
      facilityId,
      records: importState.mappedRecords,
      duplicateStrategy: importState.duplicateStrategy,
    })
    setResult(res)
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      importState.reset()
      parser.reset()
      setResult(null)
      if (result) onComplete()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import COG Data</DialogTitle>
        </DialogHeader>

        {importState.step === "upload" && (
          <FileDropzone
            accept={[".csv", ".xlsx", ".xls"]}
            onFile={handleFile}
          />
        )}

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
                onClick={() => importState.setStep("upload")}
              >
                Back
              </Button>
              <Button onClick={importState.goToPreview}>Preview</Button>
            </div>
          </div>
        )}

        {importState.step === "preview" && (
          <div className="space-y-4">
            <COGImportPreview
              records={importState.mappedRecords}
              duplicates={0}
              errors={[]}
            />
            <div className="space-y-2">
              <Label>Duplicate Strategy</Label>
              <Select
                value={importState.duplicateStrategy}
                onValueChange={(v) =>
                  importState.setDuplicateStrategy(
                    v as "skip" | "overwrite" | "keep_both"
                  )
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Skip duplicates</SelectItem>
                  <SelectItem value="overwrite">Overwrite duplicates</SelectItem>
                  <SelectItem value="keep_both">Keep both</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => importState.setStep("map")}
              >
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending}
              >
                {importMutation.isPending && (
                  <Loader2 className="animate-spin" />
                )}
                Import {importState.mappedRecords.length} Records
              </Button>
            </div>
          </div>
        )}

        {importState.step === "import" && !result && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-muted-foreground">Importing records...</p>
            <Progress value={50} />
          </div>
        )}

        {result && (
          <div className="space-y-3 py-4">
            <p className="font-medium">Import Complete</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-600">
                  {result.imported}
                </p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600">
                  {result.skipped}
                </p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600">
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
      </DialogContent>
    </Dialog>
  )
}
