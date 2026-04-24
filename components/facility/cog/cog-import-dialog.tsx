"use client"

import { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Loader2, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { FileDropzone } from "@/components/facility/cog/file-dropzone"
import { COGColumnMapper } from "@/components/facility/cog/cog-column-mapper"
import { COGImportPreview } from "@/components/facility/cog/cog-import-preview"
import {
  ImportWizardStepper,
  type ImportWizardStage,
} from "@/components/facility/cog/import-wizard-stepper"
import { useCOGImport } from "@/hooks/use-cog-import"
import { useFileParser } from "@/hooks/use-file-parser"
import { useImportCOGRecords } from "@/hooks/use-cog"
import { getVendors, createVendor } from "@/lib/actions/vendors"
import { checkCOGDuplicates, type DuplicateMatch } from "@/lib/actions/cog-duplicate-check"
import { queryKeys } from "@/lib/query-keys"
import { matchVendorByAlias } from "@/lib/vendor-aliases"

interface COGImportDialogProps {
  facilityId: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onComplete: () => void
}

// Collapse the fine-grained dialog step machine into the 4 visual
// stages the user sees in the stepper. Keeping this mapping in one
// place so new intermediate steps (e.g. AI column assist) slot in
// without breaking the header progress indicator.
function resolveWizardStage(
  step: string,
  hasResult: boolean
): ImportWizardStage {
  if (hasResult) return "success"
  if (step === "upload" || step === "mapping") return "upload"
  if (step === "map" || step === "vendor_match" || step === "duplicate_check")
    return "preview"
  // "preview" (strategy chooser) + "import" (loading) → Confirm stage.
  return "confirm"
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
    matched?: number
    unmatched?: number
    onContractRate?: number
  } | null>(null)
  // Track whether we already forwarded the current parser.data to importState
  const forwarded = useRef(false)

  // Vendor list for the vendor matching step
  const { data: vendors } = useQuery({
    queryKey: queryKeys.vendors.all,
    queryFn: () => getVendors(),
    enabled: open,
  })

  // Duplicate check results
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([])
  const [duplicateChecking, setDuplicateChecking] = useState(false)
  // Track which duplicate records the user has chosen to exclude
  const [excludedIndices, setExcludedIndices] = useState<Set<number>>(new Set())

  // Extract unique vendor names from mapped records for the vendor matching step
  const uniqueVendorNames = useMemo(() => {
    if (importState.step !== "vendor_match") return []
    const names = new Set<string>()
    for (const r of importState.mappedRecords) {
      if (r.vendorName) names.add(r.vendorName)
    }
    return Array.from(names).sort()
  }, [importState.step, importState.mappedRecords])

  const queryClient = useQueryClient()
  // Track vendor names currently being created
  const [creatingVendors, setCreatingVendors] = useState<Set<string>>(new Set())

  const handleCreateVendor = useCallback(
    async (vendorName: string) => {
      setCreatingVendors((prev) => new Set(prev).add(vendorName))
      try {
        const newVendor = await createVendor({ name: vendorName, tier: "standard" })
        // Refresh the vendor list
        await queryClient.invalidateQueries({ queryKey: queryKeys.vendors.all })
        // Auto-select the newly created vendor
        importState.setVendorMappings({
          ...importState.vendorMappings,
          [vendorName]: newVendor.id,
        })
        toast.success(`Vendor "${vendorName}" created`)
      } catch {
        toast.error(`Failed to create vendor "${vendorName}"`)
      } finally {
        setCreatingVendors((prev) => {
          const next = new Set(prev)
          next.delete(vendorName)
          return next
        })
      }
    },
    [queryClient, importState]
  )

  // Auto-match vendor names using known aliases when entering vendor_match step
  useEffect(() => {
    if (importState.step !== "vendor_match" || !vendors || vendors.length === 0) return
    const autoMappings: Record<string, string> = {}
    for (const name of uniqueVendorNames) {
      // Skip if already mapped
      if (importState.vendorMappings[name]) continue
      const matchedId = matchVendorByAlias(name, vendors)
      if (matchedId) {
        autoMappings[name] = matchedId
      }
    }
    if (Object.keys(autoMappings).length > 0) {
      importState.setVendorMappings({
        ...importState.vendorMappings,
        ...autoMappings,
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importState.step, vendors, uniqueVendorNames])

  const handleFile = async (file: File) => {
    if (file.name.toLowerCase().endsWith(".pdf")) {
      toast.error(
        "PDF parsing is not yet supported for COG data. Please export your data as CSV or Excel."
      )
      return
    }
    forwarded.current = false
    await parser.parseFile(file)
  }

  // Move parsed data into import state via useEffect (not during render)
  useEffect(() => {
    if (parser.data && importState.step === "upload" && !forwarded.current) {
      forwarded.current = true
      importState.setParsedData(parser.data.headers, parser.data.rows)
    }
  }, [parser.data, importState])

  // Run duplicate check when entering the duplicate_check step
  useEffect(() => {
    if (importState.step !== "duplicate_check") return
    if (importState.mappedRecords.length === 0) return

    let cancelled = false
    setDuplicateChecking(true)
    setDuplicates([])
    setExcludedIndices(new Set())

    // Full-key duplicate check (Charles W1.W-A2): pass every
    // business-relevant column so an existing row only flags when it's
    // byte-for-byte identical. Quantity / unitCost / extendedPrice were
    // missing here previously, which made "same invNo + same day"
    // enough to trip the detector and mask legitimate reorders.
    const keys = importState.mappedRecords.map((r) => ({
      inventoryNumber: r.inventoryNumber,
      vendorItemNo: r.vendorItemNo ?? undefined,
      transactionDate: r.transactionDate,
      quantity: r.quantity,
      unitCost: r.unitCost,
      extendedPrice: r.extendedPrice ?? r.unitCost * r.quantity,
    }))

    checkCOGDuplicates({ facilityId, keys })
      .then((matches) => {
        if (!cancelled) {
          setDuplicates(matches)
        }
      })
      .catch(() => {
        // If check fails, proceed without blocking — no duplicates marked
        if (!cancelled) setDuplicates([])
      })
      .finally(() => {
        if (!cancelled) setDuplicateChecking(false)
      })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [importState.step, facilityId])

  const handleImport = async () => {
    importState.setStep("import")
    try {
      const res = await importMutation.mutateAsync({
        facilityId,
        records: importState.mappedRecords,
        duplicateStrategy: importState.duplicateStrategy,
      })
      setResult(res)
    } catch {
      // Error is handled by the mutation's onError callback
      importState.setStep("preview")
    }
  }

  const handleClose = (nextOpen: boolean) => {
    if (!nextOpen) {
      importState.reset()
      parser.reset()
      forwarded.current = false
      setResult(null)
      setDuplicates([])
      setDuplicateChecking(false)
      setExcludedIndices(new Set())
      setCreatingVendors(new Set())
      if (result) onComplete()
    }
    onOpenChange(nextOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-7xl w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import COG Data</DialogTitle>
        </DialogHeader>

        <div className="border-b pb-4">
          <ImportWizardStepper
            stage={resolveWizardStage(importState.step, !!result)}
          />
        </div>

        {importState.step === "upload" && (
          <FileDropzone
            accept={[".csv", ".xlsx", ".xls", ".pdf"]}
            onFile={handleFile}
          />
        )}

        {importState.step === "mapping" && (
          <div className="space-y-3 py-4 text-center">
            <Sparkles className="mx-auto h-8 w-8 animate-pulse text-primary" />
            <p className="text-sm text-muted-foreground">
              AI is mapping your columns...
            </p>
            <Progress value={50} />
          </div>
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
                onClick={() => {
                  forwarded.current = false
                  parser.reset()
                  importState.setStep("upload")
                }}
              >
                Back
              </Button>
              <Button onClick={importState.goToVendorMatch}>Next</Button>
            </div>
          </div>
        )}

        {importState.step === "vendor_match" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Match Vendor Names</h3>
              <p className="text-sm text-muted-foreground">
                Map vendor names from your import file to existing vendors in the
                system. Unmatched names will be imported as-is.
              </p>
            </div>
            <div className="max-h-[400px] overflow-auto rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Import Vendor Name</TableHead>
                    <TableHead>Match To</TableHead>
                    <TableHead className="w-[80px]">Records</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {uniqueVendorNames.map((name) => {
                    const count = importState.mappedRecords.filter(
                      (r) => r.vendorName === name
                    ).length
                    return (
                      <TableRow key={name}>
                        <TableCell className="font-medium">{name}</TableCell>
                        <TableCell>
                          <Select
                            value={importState.vendorMappings[name] ?? "__none__"}
                            onValueChange={(v) => {
                              if (v === "__create_new__") {
                                handleCreateVendor(name)
                                return
                              }
                              importState.setVendorMappings({
                                ...importState.vendorMappings,
                                [name]: v === "__none__" ? "" : v,
                              })
                            }}
                          >
                            <SelectTrigger className="w-[220px]" disabled={creatingVendors.has(name)}>
                              <SelectValue placeholder={creatingVendors.has(name) ? "Creating..." : "Select vendor..."} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__create_new__" className="text-primary font-medium">
                                + Create as New Vendor
                              </SelectItem>
                              <SelectItem value="__none__">
                                — Keep as text —
                              </SelectItem>
                              {vendors?.map((v) => (
                                <SelectItem key={v.id} value={v.id}>
                                  {v.displayName || v.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{count}</Badge>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => importState.setStep("map")}
              >
                Back
              </Button>
              <Button onClick={importState.goToDuplicateCheck}>
                Next
              </Button>
            </div>
          </div>
        )}

        {importState.step === "duplicate_check" && (
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-medium">Duplicate Check</h3>
              <p className="text-sm text-muted-foreground">
                Checking your records against existing data for potential
                duplicates.
              </p>
            </div>

            {!duplicateChecking && (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Total rows</p>
                  <p className="text-xl font-semibold tabular-nums">
                    {importState.mappedRecords.length.toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Unique</p>
                  <p className="text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {(
                      importState.mappedRecords.length - duplicates.length
                    ).toLocaleString()}
                  </p>
                </div>
                <div className="rounded-md border bg-card p-3">
                  <p className="text-xs text-muted-foreground">Duplicates</p>
                  <p className="text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                    {duplicates.length.toLocaleString()}
                  </p>
                </div>
              </div>
            )}

            {duplicateChecking && (
              <div className="space-y-3 py-4 text-center">
                <Loader2 className="mx-auto h-8 w-8 animate-spin text-primary" />
                <p className="text-sm text-muted-foreground">
                  Checking for duplicates...
                </p>
                <Progress value={50} />
              </div>
            )}

            {!duplicateChecking && duplicates.length === 0 && (
              <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-800 dark:bg-emerald-950">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                <p className="text-sm text-emerald-700 dark:text-emerald-300">
                  No duplicates found. All {importState.mappedRecords.length}{" "}
                  records are new.
                </p>
              </div>
            )}

            {!duplicateChecking && duplicates.length > 0 && (
              <>
                <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950">
                  <AlertTriangle className="h-5 w-5 text-amber-600" />
                  <p className="text-sm text-amber-700 dark:text-amber-300">
                    Found {duplicates.length} potential duplicate(s). Select
                    records to exclude or proceed with all.
                  </p>
                </div>
                <div className="flex items-center justify-between gap-2 text-xs">
                  <div className="text-muted-foreground">
                    {excludedIndices.size === 0
                      ? "No duplicates excluded — all will be imported per the strategy on the next step."
                      : `${excludedIndices.size} of ${duplicates.length} excluded (will be skipped entirely).`}
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExcludedIndices(
                          new Set(duplicates.map((_, i) => i)),
                        )
                      }
                      disabled={excludedIndices.size === duplicates.length}
                    >
                      Exclude all
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setExcludedIndices(new Set())}
                      disabled={excludedIndices.size === 0}
                    >
                      Clear
                    </Button>
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[40px]">
                          <input
                            type="checkbox"
                            aria-label="Toggle exclude all"
                            checked={
                              excludedIndices.size > 0 &&
                              excludedIndices.size === duplicates.length
                            }
                            ref={(el) => {
                              if (el) {
                                el.indeterminate =
                                  excludedIndices.size > 0 &&
                                  excludedIndices.size < duplicates.length
                              }
                            }}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setExcludedIndices(
                                  new Set(duplicates.map((_, i) => i)),
                                )
                              } else {
                                setExcludedIndices(new Set())
                              }
                            }}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </TableHead>
                        <TableHead>Inventory #</TableHead>
                        <TableHead>Vendor</TableHead>
                        <TableHead>Existing Description</TableHead>
                        <TableHead>Existing Cost</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {duplicates.map((dup, idx) => (
                        <TableRow key={`${dup.existingId}-${idx}`}>
                          <TableCell>
                            <input
                              type="checkbox"
                              checked={excludedIndices.has(idx)}
                              onChange={(e) => {
                                setExcludedIndices((prev) => {
                                  const next = new Set(prev)
                                  if (e.target.checked) {
                                    next.add(idx)
                                  } else {
                                    next.delete(idx)
                                  }
                                  return next
                                })
                              }}
                              className="h-4 w-4 rounded border-gray-300"
                            />
                          </TableCell>
                          <TableCell className="font-medium">
                            {dup.inventoryNumber}
                          </TableCell>
                          <TableCell>{dup.existingVendor ?? "—"}</TableCell>
                          <TableCell>{dup.existingDescription ?? "—"}</TableCell>
                          <TableCell>
                            ${dup.existingUnitCost.toFixed(2)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}

            {!duplicateChecking && (
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => {
                    setDuplicates([])
                    setExcludedIndices(new Set())
                    const hasVendorNames = importState.mappedRecords.some(
                      (r) => r.vendorName
                    )
                    importState.setStep(hasVendorNames ? "vendor_match" : "map")
                  }}
                >
                  Back
                </Button>
                <Button
                  onClick={() => {
                    // If user excluded some duplicate records, filter them out
                    if (excludedIndices.size > 0) {
                      const excludedInventoryNumbers = new Set(
                        Array.from(excludedIndices).map(
                          (i) => duplicates[i]?.inventoryNumber
                        )
                      )
                      const filtered = importState.mappedRecords.filter(
                        (r) => !excludedInventoryNumbers.has(r.inventoryNumber)
                      )
                      importState.setMappedRecords(filtered)
                    }
                    importState.goToPreview()
                  }}
                >
                  Continue to Preview ({importState.mappedRecords.length - excludedIndices.size}{" "}
                  records)
                </Button>
              </div>
            )}
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
                onClick={() => {
                  setExcludedIndices(new Set())
                  importState.setStep("duplicate_check")
                }}
              >
                Back
              </Button>
              <Button
                onClick={handleImport}
                disabled={importMutation.isPending || importState.mappedRecords.length === 0}
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
          <div
            className="flex flex-col items-center justify-center space-y-4 py-12 text-center"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="h-12 w-12 animate-spin text-primary" />
            <div className="space-y-1">
              <p className="text-base font-medium">
                Importing {importState.mappedRecords.length.toLocaleString()}{" "}
                record{importState.mappedRecords.length === 1 ? "" : "s"}...
              </p>
              <p className="text-sm text-muted-foreground">
                Please keep this window open while we ingest your data.
              </p>
            </div>
            <p className="text-xs text-muted-foreground">
              This may take 30-60s for files with 500+ rows.
            </p>
          </div>
        )}

        {result && (
          <div className="space-y-4 py-4">
            <p className="font-medium">Import Complete</p>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-2xl font-bold text-emerald-600">
                  {result.imported}
                </p>
                <p className="text-xs text-muted-foreground">Imported</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {result.skipped}
                </p>
                <p className="text-xs text-muted-foreground">Skipped</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                  {result.errors}
                </p>
                <p className="text-xs text-muted-foreground">Errors</p>
              </div>
            </div>
            {/* Alignment: each card is the same height, the big number
                anchors at the top of the body, and every card carries a
                one-line subtitle (even if it's just `—`) so the three
                numbers sit at identical baselines. Previously only the
                middle card had a subtitle, leaving the outer two
                visually taller and the numbers misaligned. */}
            <div className="grid gap-3 sm:grid-cols-3">
              <Card className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Records imported</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-1">
                  <p className="text-2xl font-bold leading-tight">{result.imported}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.skipped} skipped · {result.errors} errors
                  </p>
                </CardContent>
              </Card>
              <Card className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Matched to contracts</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-1">
                  <p className="text-2xl font-bold leading-tight">{result.matched ?? 0}</p>
                  <p className="text-xs text-muted-foreground">
                    {result.unmatched ?? 0} unmatched
                  </p>
                </CardContent>
              </Card>
              <Card className="flex flex-col">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">On-contract rate</CardTitle>
                </CardHeader>
                <CardContent className="flex-1 space-y-1">
                  <p className="text-2xl font-bold leading-tight">
                    {((result.onContractRate ?? 0) * 100).toFixed(1)}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {result.matched ?? 0} of {result.imported} imported
                  </p>
                </CardContent>
              </Card>
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
