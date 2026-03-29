"use client"

import { useState, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Upload, FileSpreadsheet } from "lucide-react"
import { useImportCases } from "@/hooks/use-case-costing"
import type { CaseInput } from "@/lib/validators/cases"

interface CaseImportDialogProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

export function CaseImportDialog({
  facilityId,
  open,
  onOpenChange,
  onComplete,
}: CaseImportDialogProps) {
  const [file, setFile] = useState<File | null>(null)
  const [progress, setProgress] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const importMutation = useImportCases()

  async function handleImport() {
    if (!file) return
    setProgress(20)

    const text = await file.text()
    const lines = text.split("\n").filter((l) => l.trim())
    const headers = lines[0]?.split(",").map((h) => h.trim().toLowerCase()) ?? []

    setProgress(50)

    const cases: CaseInput[] = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim())
      const get = (key: string) => vals[headers.indexOf(key)] ?? ""
      return {
        caseNumber: get("case_number") || get("casenumber") || get("case#"),
        surgeonName: get("surgeon_name") || get("surgeon") || undefined,
        dateOfSurgery: get("date_of_surgery") || get("date") || get("surgery_date"),
        primaryCptCode: get("cpt_code") || get("cpt") || undefined,
        totalSpend: parseFloat(get("total_spend") || get("spend") || "0"),
        totalReimbursement: parseFloat(get("reimbursement") || "0") || undefined,
        timeInOr: get("time_in") || undefined,
        timeOutOr: get("time_out") || undefined,
      }
    })

    setProgress(70)

    await importMutation.mutateAsync({ facilityId, cases })
    setProgress(100)
    setFile(null)
    onComplete()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import Case Data</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <input
            ref={inputRef}
            type="file"
            accept=".csv,.xlsx"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <div className="flex items-center gap-2 rounded-md border p-3">
              <FileSpreadsheet className="size-5 text-muted-foreground" />
              <span className="flex-1 truncate text-sm">{file.name}</span>
              <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
                Remove
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="size-4" /> Select CSV or XLSX file
            </Button>
          )}
          {progress > 0 && progress < 100 && (
            <Progress value={progress} className="h-1.5" />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleImport}
              disabled={!file || importMutation.isPending}
            >
              {importMutation.isPending ? "Importing..." : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
