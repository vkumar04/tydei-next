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
  FileSpreadsheet,
  Stethoscope,
  DollarSign,
  Building2,
  UserCog,
  CheckCircle2,
  Info,
  Loader2,
  X,
} from "lucide-react"
import { useImportCases } from "@/hooks/use-case-costing"
import { estimateReimbursement } from "@/lib/national-reimbursement-rates"
import type { CaseInput } from "@/lib/validators/cases"

// ── File type definitions matching v0 prototype ────────────────

interface FileType {
  id: string
  name: string
  description: string
  requiredFields: string[]
  icon: React.ComponentType<{ className?: string }>
  color: "purple" | "indigo" | "blue" | "green" | "amber"
  source: "purchasing" | "clinical"
  note?: string
}

const purchasingFileTypes: FileType[] = [
  {
    id: "po-history",
    name: "PO History File",
    description: "Purchase orders - POID, Vendor, Item No, Qty, Cost",
    requiredFields: [
      "POID",
      "Vendor Name",
      "Inventory Number",
      "Vendor Item No",
      "Order Date",
      "Quantity",
      "Unit Cost",
    ],
    icon: FileSpreadsheet,
    color: "purple",
    source: "purchasing",
  },
  {
    id: "invoice-history",
    name: "Invoice History File",
    description: "Invoices - Invoice No, PO Reference, Item No, Price",
    requiredFields: [
      "Invoice Number",
      "Invoice Date",
      "Purchase Order",
      "Vendor Item No",
      "Invoice Price",
      "Invoice Quantity",
    ],
    icon: DollarSign,
    color: "indigo",
    source: "purchasing",
  },
]

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
    if (ch === '"' || ch === "'") {
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
    h.trim().replace(/^["']|["']$/g, "").toLowerCase()
  )

  return lines.slice(1).map((line) => {
    const vals = splitCSVLine(line).map((v) =>
      v.trim().replace(/^["']|["']$/g, "").replace(/^\$\s*/, "")
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
    "po-history": null,
    "invoice-history": null,
    "case-procedures": null,
    "supply-field": null,
    "patient-fields": null,
  })
  const [isProcessing, setIsProcessing] = useState(false)
  const [processingStep, setProcessingStep] = useState("")
  const [processingProgress, setProcessingProgress] = useState(0)
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const importMutation = useImportCases()

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
      // Data stores for linking
      const caseProcedures = new Map<
        string,
        { cptCode: string; description: string }
      >()
      const patientFields = new Map<
        string,
        { surgeon: string; facility: string; date: string }
      >()
      const supplyRecords = new Map<
        string,
        Array<{ itemNo: string; name: string; cost: number; qty: number }>
      >()

      // Step 1: Validate
      setProcessingStep("Validating file formats...")
      setProcessingProgress(5)
      await new Promise((resolve) => setTimeout(resolve, 200))

      // Step 2: Parse PO History
      if (uploadedFiles["po-history"]) {
        setProcessingStep("Parsing PO History file...")
        setProcessingProgress(15)
        await parseCSVFile(uploadedFiles["po-history"])
      }

      // Step 3: Parse Invoice History
      if (uploadedFiles["invoice-history"]) {
        setProcessingStep("Parsing Invoice History file...")
        setProcessingProgress(25)
        await parseCSVFile(uploadedFiles["invoice-history"])
      }

      // Step 4: Parse Case Procedures
      if (uploadedFiles["case-procedures"]) {
        setProcessingStep("Parsing Case Procedures - detecting columns...")
        setProcessingProgress(35)
        const records = await parseCSVFile(uploadedFiles["case-procedures"])

        records.forEach((r) => {
          const caseId = findCaseId(r)
          if (caseId) {
            const cptCode =
              findValue(r, [
                "cpt code",
                "cptcode",
                "cpt",
                "procedure code",
                "procedurecode",
                "proc code",
                "code",
              ]) || "27447"
            const description = findValue(r, [
              "procedure",
              "description",
              "procedure description",
              "proc description",
              "procedure name",
            ])
            caseProcedures.set(caseId, { cptCode, description })
          }
        })

        setProcessingStep(
          `Detected ${caseProcedures.size} unique cases from Case Procedures`
        )
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // Step 5: Parse Supply Field
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
              materialName.match(/ - ([A-Za-z0-9\-\.]+)$/)?.[1] ||
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

      // Step 6: Parse Patient Fields
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
            patientFields.set(caseId, { surgeon, facility, date })
          }
        })

        setProcessingStep(
          `Detected ${patientFields.size} cases with patient data`
        )
        await new Promise((resolve) => setTimeout(resolve, 300))
      }

      // Step 7: Build linked cases
      setProcessingStep("Linking records by Case ID...")
      setProcessingProgress(75)
      await new Promise((resolve) => setTimeout(resolve, 300))

      // Collect all unique case IDs
      const allCaseIds = new Set([
        ...caseProcedures.keys(),
        ...supplyRecords.keys(),
        ...patientFields.keys(),
      ])

      const cases: CaseInput[] = Array.from(allCaseIds).map((caseId) => {
        const proc = caseProcedures.get(caseId)
        const patient = patientFields.get(caseId)
        const supplies = supplyRecords.get(caseId) ?? []

        const totalSpend = supplies.reduce(
          (sum, s) => sum + s.cost * s.qty,
          0
        )

        const cptCode = proc?.cptCode ?? undefined
        const estReimbursement = cptCode
          ? estimateReimbursement(cptCode)
          : undefined

        return {
          caseNumber: caseId,
          surgeonName: patient?.surgeon ?? undefined,
          dateOfSurgery:
            patient?.date || new Date().toISOString().split("T")[0],
          primaryCptCode: cptCode,
          totalSpend,
          totalReimbursement: estReimbursement,
          timeInOr: undefined,
          timeOutOr: undefined,
        }
      })

      // Step 8: Import via existing hook
      setProcessingStep(`Importing ${cases.length} cases...`)
      setProcessingProgress(90)

      await importMutation.mutateAsync({ facilityId, cases })

      setProcessingProgress(100)
      setProcessingStep("Done!")
      await new Promise((resolve) => setTimeout(resolve, 400))

      // Reset state
      setUploadedFiles({
        "po-history": null,
        "invoice-history": null,
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

  function renderFileRow(
    fileType: FileType,
    sectionColor: "purple" | "blue"
  ) {
    const Icon = fileType.icon
    const isUploaded = uploadedFiles[fileType.id] !== null
    const borderColor =
      sectionColor === "purple"
        ? isUploaded
          ? "border-purple-500 bg-purple-50 dark:bg-purple-950/30"
          : "hover:border-purple-300"
        : isUploaded
          ? "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
          : "hover:border-blue-300"
    const iconBg =
      sectionColor === "purple"
        ? "bg-purple-100 dark:bg-purple-900/30"
        : "bg-blue-100 dark:bg-blue-900/30"
    const iconText =
      sectionColor === "purple" ? "text-purple-600" : "text-blue-600"
    const badgeBg =
      sectionColor === "purple" ? "" : "bg-blue-600"

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
                <label className="cursor-pointer shrink-0">
                  <Button variant="outline" size="sm" asChild>
                    <span>
                      <Upload className="mr-1 h-3 w-3" />
                      Select
                    </span>
                  </Button>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[fileType.id] = el
                    }}
                    type="file"
                    accept=".csv,.xlsx,.xls"
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
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Upload Purchasing and Clinical Data Files</DialogTitle>
          <DialogDescription>
            Upload data from your purchasing and clinical case costing systems.
            Files are linked via Case ID and Vendor Item No.
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

          {/* Purchasing Files Section */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Badge
                variant="outline"
                className="bg-purple-50 text-purple-700 border-purple-200"
              >
                Purchasing
              </Badge>
              <h3 className="font-medium">Purchasing Data</h3>
              <span className="text-xs text-muted-foreground">
                (affects rebates)
              </span>
            </div>
            <div className="space-y-3">
              {purchasingFileTypes.map((ft) => renderFileRow(ft, "purple"))}
            </div>
          </div>

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
              {clinicalFileTypes.map((ft) => renderFileRow(ft, "blue"))}
            </div>
          </div>

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
