"use client"

import { useState, useRef } from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Upload,
  Stethoscope,
  Building2,
  UserCog,
  CheckCircle2,
  Info,
  Loader2,
  X,
} from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { queryKeys } from "@/lib/query-keys"
import { useImportCases } from "@/hooks/use-case-costing"
import {
  importCaseSupplies,
  importCaseProcedures,
  recomputeSupplyContractStatus,
} from "@/lib/actions/cases"
import type { CaseInput } from "@/lib/validators/cases"

// ── File type definitions matching v0 prototype ────────────────

interface FileType {
  id: string
  name: string
  description: string
  requiredFields: string[]
  icon: React.ComponentType<{ className?: string }>
  color: "blue" | "green" | "amber"
  source: "clinical"
  note?: string
}

// Audit H4: the PO History / Invoice History drop zones were removed —
// they advertised "(affects rebates)" but parsed the file and discarded
// every row. Purchasing data belongs to the Invoice import flow (see the
// note rendered in the dialog body), which actually persists it.

const clinicalFileTypes: FileType[] = [
  {
    id: "case-procedures",
    name: "Case Procedures File",
    description: "Procedures - Case ID, CPT/Procedure Code",
    requiredFields: ["Case ID", "CPT Code"],
    icon: Stethoscope,
    color: "blue",
    source: "clinical",
  },
  {
    id: "supply-field",
    name: "Supply Field File",
    description:
      "Supplies - Case ID, Material Name (with Vendor Item No), Used Cost, Qty",
    requiredFields: ["Case ID", "Material Name", "Used Cost", "Quantity"],
    icon: Building2,
    color: "green",
    source: "clinical",
    note: "This data does NOT affect rebates - only PO/Invoice data does",
  },
  {
    id: "patient-fields",
    name: "Patient Fields File",
    description:
      "Patient data - Case ID, Surgeon Name, Facility, Date of Surgery",
    requiredFields: [
      "Case ID",
      "Surgeon Name",
      "Facility Name",
      "Date of Surgery",
    ],
    icon: UserCog,
    color: "amber",
    source: "clinical",
  },
]

// ── CSV parser (handles quoted fields with commas) ────────────

function splitCSVLine(line: string): string[] {
  const fields: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    // Audit M14(d): only double-quotes delimit CSV fields. Treating
    // apostrophes as quote chars corrupted any value containing one
    // (e.g. surgeon "O'Brien" swallowed the following comma).
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === ch) {
        // Escaped quote
        current += ch
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === "," && !inQuotes) {
      fields.push(current)
      current = ""
    } else {
      current += ch
    }
  }
  fields.push(current)
  return fields
}

async function parseCSVFile(
  file: File
): Promise<Record<string, string>[]> {
  const text = await file.text()
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []

  const headers = splitCSVLine(lines[0] ?? "").map((h) =>
    h.trim().replace(/^"|"$/g, "").toLowerCase()
  )

  return lines.slice(1).map((line) => {
    const vals = splitCSVLine(line).map((v) =>
      v.trim().replace(/^"|"$/g, "").replace(/^\$\s*/, "")
    )
    const obj: Record<string, string> = {}
    headers.forEach((h, i) => {
      obj[h] = vals[i] ?? ""
    })
    return obj
  })
}

/** Parse a date string like "12/5/2023" or "2023-12-05" into YYYY-MM-DD */
function parseDate(raw: string): string {
  if (!raw || !raw.trim()) return ""
  const trimmed = raw.trim()

  // MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (slashMatch) {
    const [, m, d, y] = slashMatch
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`
  }

  // Already ISO YYYY-MM-DD
  const isoMatch = trimmed.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (isoMatch) {
    const [, y, m, d] = isoMatch
    return `${y}-${m!.padStart(2, "0")}-${d!.padStart(2, "0")}`
  }

  // Fallback: try native Date parsing
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) return d.toISOString().split("T")[0]

  return ""
}

// ── Column-matching helpers ────────────────────────────────────

function findValue(
  row: Record<string, string>,
  candidates: string[]
): string {
  for (const key of candidates) {
    if (row[key] !== undefined && row[key] !== "") return row[key]
  }
  return ""
}

function findCaseId(row: Record<string, string>): string {
  return findValue(row, [
    "case id",
    "caseid",
    "case_id",
    "case number",
    "casenumber",
    "case_number",
    "encounter",
    "encounter id",
    "encounterid",
    "mrn",
  ])
}

// ── Component ──────────────────────────────────────────────────

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
  const [uploadedFiles, setUploadedFiles] = useState<
    Record<string, File | null>
  >({
    "case-procedures": null,
    "supply-field": null,
    "patient-fields": null,
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState("")
  const [processingProgress, setProcessingProgress] = useState(0)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const importMutation = useImportCases()
  const queryClient = useQueryClient()

  const handleFileUpload = (fileType: string, file: File) => {
    setUploadedFiles((prev) => ({ ...prev, [fileType]: file }))
  }

  const canProcess =
    uploadedFiles["case-procedures"] !== null ||
    uploadedFiles["patient-fields"] !== null

  const processFiles = async () => {
    setIsProcessing(true)
    setProcessingProgress(0)

    try {
      // Data stores for linking. Audit M14(b): procedures accumulate
      // ALL rows per case (the old Map.set kept only the last row).
      const caseProcedures = new Map<
        string,
        Array<{ cptCode: string; description: string }>
      >()
      const patientFields = new Map<
        string,
        {
          surgeon: string
          facility: string
          date: string
          payorClass: string | undefined
        }
      >()
      const supplyRecords = new Map<
        string,
        Array<{ itemNo: string; name: string; cost: number; qty: number }>
      >()

      // Step 1: Validate
      setProcessingStep("Validating file formats...")
      setProcessingProgress(5)
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Step 2: Parse Case Procedures
      if (uploadedFiles["case-procedures"]) {
        setProcessingStep("Parsing Case Procedures - detecting columns...")
        setProcessingProgress(25)
        const records = await parseCSVFile(uploadedFiles["case-procedures"])

        records.forEach((r) => {
          const caseId = findCaseId(r)
          if (caseId) {
            // Audit M14(a): no hardcoded CPT default — rows without a
            // detectable code are skipped rather than invented.
            const cptCode = findValue(r, [
              "cpt code",
              "cptcode",
              "cpt",
              "procedure code",
              "procedurecode",
              "proc code",
              "code",
            ])
            if (!cptCode) return
            const description = findValue(r, [
              "procedure",
              "description",
              "procedure description",
              "proc description",
              "procedure name",
            ])
            const list = caseProcedures.get(caseId) ?? []
            list.push({ cptCode, description })
            caseProcedures.set(caseId, list)
          }
        })

        setProcessingStep(
          `Detected ${caseProcedures.size} unique cases from Case Procedures`
        )
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // Step 3: Parse Supply Field
      if (uploadedFiles["supply-field"]) {
        setProcessingStep("Parsing Supply Field - detecting columns...")
        setProcessingProgress(45)
        const records = await parseCSVFile(uploadedFiles["supply-field"])

        records.forEach((r) => {
          const caseId = findCaseId(r)
          if (caseId) {
            if (!supplyRecords.has(caseId)) supplyRecords.set(caseId, [])
            const materialName = findValue(r, [
              "material name",
              "materialname",
              "item name",
              "itemname",
              "description",
              "item",
              "product",
              "supply",
            ])
            const itemNo =
              findValue(r, [
                "catalog number",
                "catalog no",
                "catalogno",
                "catalog",
                "vendor item no",
                "vendoritemno",
                "item no",
                "itemno",
                "vendor item",
                "vendoritem",
                "item number",
                "itemnumber",
                "sku",
              ]) ||
              materialName.match(/ - ([A-Za-z0-9\-.]+)$/)?.[1] ||
              ""
            const cost =
              parseFloat(
                findValue(r, [
                  "used cost",
                  "usedcost",
                  "unit cost",
                  "unitcost",
                  "cost",
                  "price",
                  "amount",
                  "extended cost",
                  "extendedcost",
                  "total cost",
                  "totalcost",
                ]) || "0"
              ) || 0
            const qty =
              parseInt(
                findValue(r, [
                  "quantity used",
                  "quantityused",
                  "quantity",
                  "qty",
                  "used qty",
                  "usedqty",
                  "count",
                  "units",
                ]) || "1"
              ) || 1
            supplyRecords.get(caseId)!.push({ itemNo, name: materialName, cost, qty })
          }
        })

        setProcessingStep(
          `Detected ${supplyRecords.size} cases with supply data`
        )
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // Step 4: Parse Patient Fields
      if (uploadedFiles["patient-fields"]) {
        setProcessingStep("Parsing Patient Fields - detecting columns...")
        setProcessingProgress(55)
        const records = await parseCSVFile(uploadedFiles["patient-fields"])

        records.forEach((r) => {
          const caseId = findCaseId(r)
          if (caseId) {
            const surgeon =
              findValue(r, [
                "surgeon name",
                "surgeonname",
                "surgeon",
                "physician",
                "physician name",
                "physicianname",
                "doctor",
                "doctor name",
                "attending",
                "attending physician",
                "provider",
                "provider name",
              ]) || "Unknown Surgeon"
            const facility =
              findValue(r, [
                "facility name",
                "facilityname",
                "facility",
                "hospital",
                "hospital name",
                "hospitalname",
                "location",
                "site",
                "clinic",
                "center",
                "building",
              ]) || "Main Hospital"
            const rawDate = findValue(r, [
                "date of surgery",
                "surgery date",
                "surgerydate",
                "procedure date",
                "proceduredate",
                "dos",
                "service date",
                "servicedate",
                "date",
                "admit date",
                "discharge date",
              ])
            const date =
              parseDate(rawDate) || new Date().toISOString().split("T")[0]
            // 2026-06-14: capture the payor/insurance class so the Surgeons
            // + Facility payor-mix surfaces have data. Raw carrier string;
            // bucketed at read time by `classifyPayorClass`. Generous alias
            // list — real exports label this column many ways.
            const payorClass =
              findValue(r, [
                "payor",
                "payer",
                "payor class",
                "payer class",
                "payorclass",
                "payerclass",
                "payor name",
                "payer name",
                "payorname",
                "payername",
                "payor type",
                "payer type",
                "insurance",
                "insurance class",
                "insurance type",
                "insurance carrier",
                "insurance plan",
                "carrier",
                "plan",
                "plan name",
                "primary insurance",
                "primary payor",
                "primary payer",
                "financial class",
                "fin class",
                "coverage",
              ]) || undefined
            patientFields.set(caseId, { surgeon, facility, date, payorClass })
          }
        })

        setProcessingStep(
          `Detected ${patientFields.size} cases with patient data`
        )
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // Step 5: Build linked cases
      setProcessingStep("Linking records by Case ID...")
      setProcessingProgress(65)
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Collect all unique case IDs
      const allCaseIds = new Set([
        ...caseProcedures.keys(),
        ...supplyRecords.keys(),
        ...patientFields.keys(),
      ])

      const cases: CaseInput[] = Array.from(allCaseIds).map((caseId) => {
        const procs = caseProcedures.get(caseId)
        const patient = patientFields.get(caseId)
        const supplies = supplyRecords.get(caseId) ?? []

        const totalSpend = supplies.reduce(
          (sum, s) => sum + s.cost * s.qty,
          0
        )

        // First procedure row's CPT is the primary; all rows persist as
        // CaseProcedure records below. No code → leave null (M14a).
        const cptCode = procs?.[0]?.cptCode ?? undefined

        return {
          caseNumber: caseId,
          surgeonName: patient?.surgeon ?? undefined,
          dateOfSurgery:
            patient?.date || new Date().toISOString().split("T")[0],
          primaryCptCode: cptCode,
          totalSpend,
          // Reimbursement is only computed when a payor contract is loaded
          // and applied via calculatePayorMargins. Leaving it undefined here
          // prevents the dashboard from showing fake reimbursement/margin
          // numbers based on CPT-rate estimates.
          totalReimbursement: undefined,
          timeInOr: undefined,
          timeOutOr: undefined,
          payorClass: patient?.payorClass,
        }
      })

      // Step 6: Import via existing hook
      setProcessingStep(`Importing ${cases.length} cases...`)
      setProcessingProgress(75)

      const importResult = await importMutation.mutateAsync({
        facilityId,
        cases,
      })

      // Step 7 (audit H4): persist supplies + procedures. The parsed
      // rows previously only folded into totalSpend and were discarded —
      // the case detail drawer showed zero supplies/procedures.
      const casesToEnrich = Array.from(allCaseIds).filter(
        (caseNumber) =>
          importResult.caseIds[caseNumber] &&
          ((supplyRecords.get(caseNumber)?.length ?? 0) > 0 ||
            (caseProcedures.get(caseNumber)?.length ?? 0) > 0)
      )
      let enriched = 0
      for (const caseNumber of casesToEnrich) {
        const caseId = importResult.caseIds[caseNumber]!
        enriched++
        setProcessingStep(
          `Saving supplies & procedures (${enriched}/${casesToEnrich.length})...`
        )
        setProcessingProgress(
          75 + Math.round((enriched / casesToEnrich.length) * 20)
        )

        const supplies = supplyRecords.get(caseNumber)
        if (supplies && supplies.length > 0) {
          await importCaseSupplies({
            caseId,
            supplies: supplies.map((s) => ({
              materialName: s.name || "Unknown material",
              vendorItemNo: s.itemNo || undefined,
              usedCost: s.cost,
              quantity: s.qty,
              isOnContract: false,
            })),
          })
        }

        const procs = caseProcedures.get(caseNumber)
        if (procs && procs.length > 0) {
          await importCaseProcedures({
            caseId,
            procedures: procs.map((p) => ({
              cptCode: p.cptCode,
              description: p.description || undefined,
            })),
          })
        }
      }

      // 2026-06-14: now that supplies exist, re-match them against the
      // facility's priced contracts so On-Contract %/compliance reflect the
      // freshly-imported cases (case import previously never triggered this,
      // leaving every supply off-contract until an unrelated contract edit).
      try {
        await recomputeSupplyContractStatus()
      } catch (err) {
        console.error("[case-import] recomputeSupplyContractStatus failed", err)
      }

      // Supplies/procedures landed after the import mutation's own
      // invalidation — refresh again so counts are current.
      await queryClient.invalidateQueries({ queryKey: queryKeys.cases.all })

      setProcessingProgress(100)
      setProcessingStep("Done!")
      await new Promise((resolve) => setTimeout(resolve, 400))

      // Reset state
      setUploadedFiles({
        "case-procedures": null,
        "supply-field": null,
        "patient-fields": null,
      })
      setIsProcessing(false)
      setProcessingProgress(0)
      setProcessingStep("")
      onComplete()
      onOpenChange(false)
    } catch (error) {
      console.error("Error processing files:", error)
      setIsProcessing(false)
      setProcessingProgress(0)
      setProcessingStep("")
    }
  }

  // ── Render helpers for file-type rows ──────────────────────

  function renderFileRow(fileType: FileType) {
    const Icon = fileType.icon
    const isUploaded = uploadedFiles[fileType.id] !== null
    const borderColor = isUploaded
      ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
      : "hover:border-blue-300"
    const iconBg = "bg-blue-100 dark:bg-blue-900/30"
    const iconText = "text-blue-600"
    const badgeBg = "bg-blue-600"

    return (
      <div
        key={fileType.id}
        className={`border rounded-lg p-3 transition-colors ${borderColor}`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}
          >
            <Icon className={`h-4 w-4 ${iconText}`} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h4 className="font-medium text-sm">{fileType.name}</h4>
                <p className="text-xs text-muted-foreground">
                  {fileType.description}
                </p>
              </div>
              {isUploaded ? (
                <div className="flex items-center gap-2 shrink-0">
                  <Badge
                    variant="default"
                    className={`gap-1 ${badgeBg}`}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    <span className="truncate max-w-[80px]">
                      {uploadedFiles[fileType.id]?.name}
                    </span>
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() =>
                      setUploadedFiles((prev) => ({
                        ...prev,
                        [fileType.id]: null,
                      }))
                    }
                  >
                    <X className="h-3 w-3" />
                    <span className="sr-only">Remove file</span>
                  </Button>
                </div>
              ) : (
                <label aria-label={`Select ${fileType.name} file`} className="cursor-pointer shrink-0">
                  <Button variant="outline" size="sm" asChild>
                    <span>
                      <Upload className="mr-1 h-3 w-3" aria-hidden="true" />
                      Select
                    </span>
                  </Button>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[fileType.id] = el
                    }}
                    type="file"
                    // Audit M14(c): CSV only — this dialog parses via
                    // file.text(), so binary .xlsx/.xls would parse as
                    // garbage. Excel files go through the mass-upload
                    // flow (exceljs path in lib/actions/imports/shared.ts).
                    accept=".csv"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file) handleFileUpload(fileType.id, file)
                    }}
                  />
                </label>
              )}
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">
              Fields: {fileType.requiredFields.join(", ")}
            </p>
            {fileType.note && (
              <Alert className="mt-2 py-1 px-2">
                <Info className="h-3 w-3" />
                <AlertDescription className="text-[10px]">
                  {fileType.note}
                </AlertDescription>
              </Alert>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Dialog ─────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Clinical Case Costing Files</DialogTitle>
          <DialogDescription>
            Upload data from your clinical case costing system. Files are
            linked via Case ID.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Auto-Detection Info */}
          <Alert className="bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            <AlertTitle className="text-green-800 dark:text-green-200">
              Auto-Detection Enabled
            </AlertTitle>
            <AlertDescription className="text-green-700 dark:text-green-300 text-sm">
              <p>
                The system automatically detects and maps columns from your CSV
                files. Just upload your files and we will find matching columns
                for:
              </p>
              <div className="flex flex-wrap gap-2 mt-2">
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Case ID / Encounter / MRN
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Surgeon / Physician / Doctor
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Facility / Hospital / Location
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Date / Surgery Date / DOS
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  CPT / Procedure Code
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Material / Item / Supply
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Cost / Price / Amount
                </span>
                <span className="bg-green-100 dark:bg-green-900/30 px-2 py-0.5 rounded text-xs">
                  Quantity / Qty / Count
                </span>
              </div>
            </AlertDescription>
          </Alert>

          {/* Clinical Files Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Badge
                variant="outline"
                className="bg-blue-50 text-blue-700 border-blue-200"
              >
                Clinical
              </Badge>
              <h3 className="font-medium">Case Costing Data</h3>
              <span className="text-xs text-muted-foreground">
                (Case ID links all files)
              </span>
            </div>
            <div className="space-y-3">
              {clinicalFileTypes.map((ft) => renderFileRow(ft))}
            </div>
          </div>

          {/* Purchasing data pointer (PO/Invoice drop zones removed — H4) */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle className="text-sm">
              Importing PO or Invoice history?
            </AlertTitle>
            <AlertDescription className="text-xs">
              Purchasing data (PO History, Invoice History) affects rebates
              and is handled by the Invoice import flow — use the import
              option on the Invoices page instead of this dialog.
            </AlertDescription>
          </Alert>

          {/* Data Linking Info */}
          <Alert>
            <Info className="h-4 w-4" />
            <AlertTitle className="text-sm">
              How Data Links Together
            </AlertTitle>
            <AlertDescription className="text-xs space-y-1">
              <p>
                <strong>Case ID</strong> links clinical files: Case Procedures +
                Supply Field + Patient Fields
              </p>
              <p>
                <strong>Vendor Item No</strong> links clinical supplies to
                purchasing data for rebate calculation
              </p>
              <p>
                <strong>Important:</strong> Contract pricing overrides clinical
                costs when catalog numbers match
              </p>
            </AlertDescription>
          </Alert>

          {/* Processing Progress */}
          {isProcessing && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">{processingStep}</span>
              </div>
              <Progress value={processingProgress} />
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isProcessing}
          >
            Cancel
          </Button>
          <Button
            onClick={processFiles}
            disabled={!canProcess || isProcessing}
          >
            {isProcessing ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Processing...
              </>
            ) : (
              <>
                <Upload className="mr-2 h-4 w-4" />
                Process &amp; Link Files
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
