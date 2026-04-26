"use client"

import { useState, useCallback } from "react"
import { Card, CardContent, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import {
  Upload,
  FileText,
  DollarSign,
  Trash2,
  Eye,
  Plus,
  Sparkles,
  Loader2,
  CheckCircle2,
  Building2,
  Calendar,
} from "lucide-react"
import { toast } from "sonner"
import { usePayorContracts } from "@/hooks/use-case-costing"
import {
  useCreatePayorContract,
  useDeletePayorContract,
  useImportPayorRates,
} from "@/hooks/use-payor-contracts-manager"
import type { CreatePayorContractInput } from "@/lib/validators/payor-contracts"

interface PayorContractsManagerProps {
  facilityId: string
}

export function PayorContractsManager({ facilityId }: PayorContractsManagerProps) {
  const { data: contracts, isLoading } = usePayorContracts()
  const createMutation = useCreatePayorContract()
  const deleteMutation = useDeletePayorContract()
  const importRatesMutation = useImportPayorRates()

  // Dialog state
  const [showUploadDialog, setShowUploadDialog] = useState(false)
  const [uploadTab, setUploadTab] = useState<"new" | "add-rates">("new")
  const [showPreviewDialog, setShowPreviewDialog] = useState(false)
  const [previewContractId, setPreviewContractId] = useState<string | null>(null)

  // Form state
  const [payorName, setPayorName] = useState("")
  const [contractNumber, setContractNumber] = useState("")
  const [payorType, setPayorType] = useState<"commercial" | "medicare_advantage" | "medicaid_managed" | "workers_comp">("commercial")
  const [effectiveDate, setEffectiveDate] = useState("")
  const [expirationDate, setExpirationDate] = useState("")
  const [notes, setNotes] = useState("")

  // AI extraction state
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractedRates, setExtractedRates] = useState<{ cptCode: string; description?: string; rate: number }[]>([])
  const [extractionDone, setExtractionDone] = useState(false)

  // Manual text entry
  const [rateText, setRateText] = useState("")

  // Add-rates state
  const [selectedContractId, setSelectedContractId] = useState("")

  const previewContract = contracts?.find((c) => c.id === previewContractId)

  const resetForm = useCallback(() => {
    setPayorName("")
    setContractNumber("")
    setPayorType("commercial")
    setEffectiveDate("")
    setExpirationDate("")
    setNotes("")
    setSelectedFile(null)
    setIsExtracting(false)
    setExtractionProgress(0)
    setExtractedRates([])
    setExtractionDone(false)
    setRateText("")
    setSelectedContractId("")
  }, [])

  // Parse CPT rates from text
  function parseCPTRatesFromText(text: string): { cptCode: string; description: string; rate: number }[] {
    const rates: { cptCode: string; description: string; rate: number }[] = []
    const lines = text.split("\n").filter((l) => l.trim())
    for (const line of lines) {
      // Match: 99213, Office Visit, 150.00 or 99213 | Office Visit | 150.00 or 99213  Office Visit  $150
      const match = line.match(/(\d{5})\s*[,|\t]\s*(.+?)\s*[,|\t]\s*\$?([\d,]+\.?\d*)/)
      if (match) {
        rates.push({
          cptCode: match[1],
          description: match[2].trim(),
          rate: parseFloat(match[3].replace(/,/g, "")),
        })
        continue
      }
      // Match: 99213 $150.00 (no description)
      const simple = line.match(/(\d{5})\s+\$?([\d,]+\.?\d*)/)
      if (simple) {
        rates.push({
          cptCode: simple[1],
          description: "",
          rate: parseFloat(simple[2].replace(/,/g, "")),
        })
      }
    }
    return rates
  }

  const [extractionStep, setExtractionStep] = useState("")

  // Handle AI extraction
  async function handleExtract() {
    if (!selectedFile) return
    setIsExtracting(true)
    setExtractionProgress(5)
    setExtractionStep("Uploading document...")

    try {
      const formData = new FormData()
      formData.append("file", selectedFile)

      setExtractionStep("Reading contract PDF...")
      const interval = setInterval(() => {
        setExtractionProgress((p) => {
          if (p >= 85) return p
          const remaining = 85 - p
          return p + Math.max(0.3, remaining * 0.04)
        })
      }, 500)

      const res = await fetch("/api/ai/extract-payor-contract", {
        method: "POST",
        body: formData,
      })

      clearInterval(interval)
      setExtractionStep("Processing results...")
      setExtractionProgress(95)

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || "Extraction failed")
      }

      const { extracted } = await res.json()

      // Auto-fill form fields from extraction
      if (extracted.payorName) setPayorName(extracted.payorName)
      if (extracted.contractNumber) setContractNumber(extracted.contractNumber)
      if (extracted.effectiveDate) setEffectiveDate(extracted.effectiveDate)
      if (extracted.expirationDate) setExpirationDate(extracted.expirationDate)

      // Map extracted CPT rates
      const rates = (extracted.cptRates ?? []).map((r: { cptCode: string; description?: string | null; rate: number }) => ({
        cptCode: r.cptCode,
        description: r.description ?? "",
        rate: r.rate,
      }))
      setExtractedRates(rates)
      setExtractionDone(true)

      toast.success(`Extracted ${rates.length} CPT rates from ${selectedFile.name}`)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed")
    } finally {
      setIsExtracting(false)
    }
  }

  // Handle save new contract
  async function handleSaveContract() {
    if (!payorName || !contractNumber || !effectiveDate || !expirationDate) {
      toast.error("Please fill in all required fields")
      return
    }

    // Combine extracted + manually entered rates
    const manualRates = rateText ? parseCPTRatesFromText(rateText) : []
    const allRates = [...extractedRates, ...manualRates]

    const payload: CreatePayorContractInput = {
      payorName,
      payorType,
      facilityId,
      contractNumber,
      effectiveDate,
      expirationDate,
      status: "active",
      cptRates: allRates,
      grouperRates: [],
      implantPassthrough: true,
      implantMarkup: 0,
      notes: notes || undefined,
    }

    await createMutation.mutateAsync(payload)
    setShowUploadDialog(false)
    resetForm()
  }

  // Handle add rates to existing contract
  async function handleAddRates() {
    if (!selectedContractId) {
      toast.error("Please select a contract")
      return
    }

    const manualRates = rateText ? parseCPTRatesFromText(rateText) : []
    const allRates = [...extractedRates, ...manualRates]

    if (allRates.length === 0) {
      toast.error("No rates to import")
      return
    }

    await importRatesMutation.mutateAsync({
      contractId: selectedContractId,
      rates: allRates,
    })
    setShowUploadDialog(false)
    resetForm()
  }

  const activeContracts = contracts?.filter((c) => c.status === "active") ?? []
  const totalCptRates = contracts?.reduce((sum, c) => sum + c.cptRates.length, 0) ?? 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Payor Reimbursement Rates</h3>
          <p className="text-sm text-muted-foreground">
            Upload payor contracts to calculate case margins from CPT rates
          </p>
        </div>
        <Button onClick={() => setShowUploadDialog(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Contract
        </Button>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total Contracts</p>
            <p className="text-2xl font-bold">{contracts?.length ?? 0}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Active Contracts</p>
            <p className="text-2xl font-bold text-green-600 dark:text-green-400">
              {activeContracts.length}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-muted-foreground">Total CPT Rates</p>
            <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
              {totalCptRates}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Contract List */}
      {isLoading ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            Loading contracts...
          </CardContent>
        </Card>
      ) : !contracts || contracts.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <DollarSign className="mx-auto h-10 w-10 text-muted-foreground/50 mb-3" />
            <p className="font-medium">No payor contracts yet</p>
            <p className="text-sm text-muted-foreground mt-1">
              Upload a payor contract PDF to get started with margin analysis
            </p>
            <Button className="mt-4" onClick={() => setShowUploadDialog(true)}>
              <Upload className="mr-2 h-4 w-4" />
              Upload Contract
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {contracts.map((contract) => (
            <Card key={contract.id}>
              <CardContent className="flex items-center justify-between py-4">
                <div className="flex items-center gap-4">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium">{contract.payorName}</p>
                      <Badge
                        variant={contract.status === "active" ? "default" : "secondary"}
                      >
                        {contract.status}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-sm text-muted-foreground">
                      <span>{contract.contractNumber}</span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3 w-3" />
                        {contract.effectiveDate.split("T")[0]} — {contract.expirationDate.split("T")[0]}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{contract.cptRates.length} CPT rates</Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setPreviewContractId(contract.id)
                      setShowPreviewDialog(true)
                    }}
                  >
                    <Eye className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteMutation.mutate(contract.id)}
                    disabled={deleteMutation.isPending}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload Dialog */}
      <Dialog
        open={showUploadDialog}
        onOpenChange={(open) => {
          setShowUploadDialog(open)
          if (!open) resetForm()
        }}
      >
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Add Payor Contract</DialogTitle>
            <DialogDescription>
              Upload a payor contract PDF for AI extraction or enter rates manually
            </DialogDescription>
          </DialogHeader>

          <Tabs value={uploadTab} onValueChange={(v) => setUploadTab(v as "new" | "add-rates")}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="new">New Contract</TabsTrigger>
              <TabsTrigger value="add-rates">Add to Existing</TabsTrigger>
            </TabsList>

            <TabsContent value="new" className="space-y-4 mt-4">
              {/* Contract Details Form */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>Payor Name *</Label>
                  <Input
                    value={payorName}
                    onChange={(e) => setPayorName(e.target.value)}
                    placeholder="e.g., Blue Cross Blue Shield"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Contract Number *</Label>
                  <Input
                    value={contractNumber}
                    onChange={(e) => setContractNumber(e.target.value)}
                    placeholder="e.g., BCBS-2024-001"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Payor Type</Label>
                  <Select value={payorType} onValueChange={(v) => setPayorType(v as typeof payorType)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="commercial">Commercial</SelectItem>
                      <SelectItem value="medicare_advantage">Medicare Advantage</SelectItem>
                      <SelectItem value="medicaid_managed">Medicaid Managed</SelectItem>
                      <SelectItem value="workers_comp">Workers Comp</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div />
                <div className="space-y-2">
                  <Label>Effective Date *</Label>
                  <Input
                    type="date"
                    value={effectiveDate}
                    onChange={(e) => setEffectiveDate(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Expiration Date *</Label>
                  <Input
                    type="date"
                    value={expirationDate}
                    onChange={(e) => setExpirationDate(e.target.value)}
                  />
                </div>
              </div>

              {/* File Upload */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Upload Contract PDF (AI Extraction)
                </Label>
                <div
                  className="border-2 border-dashed rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => document.getElementById("payor-contract-file")?.click()}
                >
                  {selectedFile ? (
                    <div className="space-y-2">
                      <div className="flex items-center justify-center gap-2">
                        <FileText className="h-5 w-5 text-primary" />
                        <span className="font-medium">{selectedFile.name}</span>
                        <span className="text-sm text-muted-foreground">
                          ({(selectedFile.size / 1024).toFixed(1)} KB)
                        </span>
                      </div>
                      {isExtracting && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            {extractionStep}
                          </div>
                          <Progress value={extractionProgress} className="h-2 max-w-xs mx-auto" />
                          <p className="text-xs text-muted-foreground">This may take 1-3 minutes</p>
                        </div>
                      )}
                      {extractionDone && (
                        <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
                          <CheckCircle2 className="h-4 w-4" />
                          Extracted {extractedRates.length} CPT rates
                        </div>
                      )}
                    </div>
                  ) : (
                    <>
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                      <p className="text-sm text-muted-foreground">
                        Drop PDF here or click to browse
                      </p>
                    </>
                  )}
                </div>
                <input
                  type="file"
                  id="payor-contract-file"
                  accept=".pdf,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) {
                      setSelectedFile(file)
                      setExtractionDone(false)
                      setExtractedRates([])
                    }
                  }}
                />
                {selectedFile && !extractionDone && !isExtracting && (
                  <Button onClick={handleExtract} className="w-full">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Extract Rates with AI
                  </Button>
                )}
              </div>

              {/* Extracted Rates Preview */}
              {extractedRates.length > 0 && (
                <Alert>
                  <CheckCircle2 className="h-4 w-4" />
                  <AlertDescription>
                    Extracted {extractedRates.length} CPT rates. Review below or add more manually.
                  </AlertDescription>
                </Alert>
              )}

              {/* Manual Rate Entry */}
              <div className="space-y-2">
                <Label>Manual CPT Rate Entry</Label>
                <Textarea
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  placeholder={`Enter CPT rates (one per line):\n99213, Office Visit, 150.00\n27447, Total Knee, 15000.00\n99214, E&M Level 4, 200.00`}
                  rows={4}
                />
                <p className="text-xs text-muted-foreground">
                  Format: CPT Code, Description, Rate (one per line)
                </p>
              </div>

              {/* Notes */}
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes about this contract"
                />
              </div>
            </TabsContent>

            <TabsContent value="add-rates" className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label>Select Contract</Label>
                <Select value={selectedContractId} onValueChange={setSelectedContractId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose a contract" />
                  </SelectTrigger>
                  <SelectContent>
                    {contracts?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.payorName} — {c.contractNumber}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Same file upload + text entry for rates */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  Upload Rate Schedule (optional)
                </Label>
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                  onClick={() => document.getElementById("payor-rates-file")?.click()}
                >
                  {selectedFile ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="text-sm font-medium">{selectedFile.name}</span>
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">Upload PDF or CSV with rates</p>
                  )}
                </div>
                <input
                  type="file"
                  id="payor-rates-file"
                  accept=".pdf,.csv,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file) setSelectedFile(file)
                  }}
                />
                {selectedFile && !extractionDone && !isExtracting && (
                  <Button onClick={handleExtract} size="sm" variant="outline" className="w-full">
                    <Sparkles className="mr-2 h-4 w-4" />
                    Extract Rates
                  </Button>
                )}
              </div>

              <div className="space-y-2">
                <Label>Manual Rate Entry</Label>
                <Textarea
                  value={rateText}
                  onChange={(e) => setRateText(e.target.value)}
                  placeholder="99213, Office Visit, 150.00"
                  rows={4}
                />
              </div>
            </TabsContent>
          </Tabs>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowUploadDialog(false)}>
              Cancel
            </Button>
            {uploadTab === "new" ? (
              <Button
                onClick={handleSaveContract}
                disabled={createMutation.isPending}
              >
                {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Save Contract
              </Button>
            ) : (
              <Button
                onClick={handleAddRates}
                disabled={importRatesMutation.isPending}
              >
                {importRatesMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Import Rates
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Preview Dialog */}
      <Dialog open={showPreviewDialog} onOpenChange={setShowPreviewDialog}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{previewContract?.payorName}</DialogTitle>
            <DialogDescription>
              {previewContract?.contractNumber} — {previewContract?.payorType.replace("_", " ")}
            </DialogDescription>
          </DialogHeader>

          {previewContract && (
            <div className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Effective:</span>{" "}
                  {previewContract.effectiveDate.split("T")[0]}
                </div>
                <div>
                  <span className="text-muted-foreground">Expires:</span>{" "}
                  {previewContract.expirationDate.split("T")[0]}
                </div>
                <div>
                  <span className="text-muted-foreground">Implant Passthrough:</span>{" "}
                  {previewContract.implantPassthrough ? "Yes" : "No"}
                </div>
                <div>
                  <span className="text-muted-foreground">Implant Markup:</span>{" "}
                  {previewContract.implantMarkup}%
                </div>
              </div>

              <div>
                <h4 className="font-medium mb-2">CPT Rates ({previewContract.cptRates.length})</h4>
                <ScrollArea className="max-h-[400px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>CPT Code</TableHead>
                        <TableHead>Description</TableHead>
                        <TableHead className="text-right">Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {previewContract.cptRates.map((rate, i) => (
                        <TableRow key={i}>
                          <TableCell className="font-mono">{rate.cptCode}</TableCell>
                          <TableCell>{rate.description ?? "—"}</TableCell>
                          <TableCell className="text-right">
                            ${rate.rate.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </TableCell>
                        </TableRow>
                      ))}
                      {previewContract.cptRates.length === 0 && (
                        <TableRow>
                          <TableCell colSpan={3} className="text-center text-muted-foreground">
                            No CPT rates
                          </TableCell>
                        </TableRow>
                      )}
                    </TableBody>
                  </Table>
                </ScrollArea>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
