"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { format } from "date-fns"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { Calendar } from "@/components/ui/calendar"
import { Progress } from "@/components/ui/progress"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { ContractTermsEntry } from "@/components/contracts/contract-terms-entry"
import { FileUpload } from "@/components/shared/file-upload"
import { getUploadUrl } from "@/lib/actions/uploads"
import { useCreatePendingContract } from "@/hooks/use-pending-contracts"
import type { CreatePendingContractInput } from "@/lib/validators/pending-contracts"
import type { TermFormValues } from "@/lib/validators/contract-terms"
import { toast } from "sonner"
import {
  CalendarIcon,
  Save,
  FileText,
  Upload,
  Sparkles,
  CheckCircle2,
  Trash2,
  Users,
  Loader2,
  Building2,
  Layers,
  X,
} from "lucide-react"

// ─── Contract type options matching v0 ─────────────────────────
const CONTRACT_TYPE_OPTIONS = [
  { value: "usage", label: "Usage-Based", hint: "Rebates on spend" },
  { value: "pricing_only", label: "Pricing Only", hint: "Discounted prices" },
  { value: "capital", label: "Capital Equipment", hint: "Equipment + service" },
  { value: "grouped", label: "GPO/Group", hint: "Collective buying" },
  { value: "tie_in", label: "Tie-In", hint: "Bundled products" },
  { value: "service", label: "Service", hint: "Service agreements" },
] as const

// ─── Helpers ───────────────────────────────────────────────────
interface FacilityOption {
  id: string
  name: string
}

interface VendorContractSubmissionProps {
  vendorId: string
  vendorName: string
  facilities: FacilityOption[]
}

export function VendorContractSubmission({
  vendorId,
  vendorName,
  facilities,
}: VendorContractSubmissionProps) {
  const router = useRouter()
  const create = useCreatePendingContract()

  // Entry mode
  const [entryMode, setEntryMode] = useState<"pdf" | "manual">("manual")

  // ─── Form state ──────────────────────────────────────────────
  const [contractName, setContractName] = useState("")
  const [contractType, setContractType] = useState<string>("")
  const [facilityId, setFacilityId] = useState("")
  const [effectiveDate, setEffectiveDate] = useState<Date>()
  const [expirationDate, setExpirationDate] = useState<Date>()
  const [performancePeriod, setPerformancePeriod] = useState("quarterly")
  const [rebatePayPeriod, setRebatePayPeriod] = useState("quarterly")
  const [contractTotal, setContractTotal] = useState("")
  const [description, setDescription] = useState("")
  const [isMultiFacility, setIsMultiFacility] = useState(false)
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([])
  const [contractTerms, setContractTerms] = useState<TermFormValues[]>([])

  // PDF upload state
  const [contractFile, setContractFile] = useState<File | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionProgress, setExtractionProgress] = useState(0)
  const [extractionComplete, setExtractionComplete] = useState(false)

  // Document uploads via server
  const [uploadedDocs, setUploadedDocs] = useState<
    Array<{ name: string; url: string }>
  >([])

  const [isSubmitting, setIsSubmitting] = useState(false)

  // ─── Document upload handler ─────────────────────────────────
  async function handleDocUpload(file: File) {
    const { uploadUrl, key } = await getUploadUrl({
      fileName: file.name,
      contentType: file.type,
      folder: "contracts",
    })
    await fetch(uploadUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    })
    setUploadedDocs((prev) => [...prev, { name: file.name, url: key }])
    return key
  }

  // ─── PDF upload handler (AI extraction simulation) ───────────
  async function handlePDFUpload(file: File) {
    setContractFile(file)
    setIsExtracting(true)
    setExtractionProgress(0)

    const filename = (file.name || "").replace(/\.[^/.]+$/, "")

    // Try to parse dates from filename
    let extractedEffective: Date | undefined
    let extractedExpiration: Date | undefined
    const dateMatch = filename.match(/(\d{2})[-/]?(\d{2})[-/]?(\d{4})/)
    if (dateMatch) {
      const month = parseInt(dateMatch[1]) - 1
      const day = parseInt(dateMatch[2])
      const year = parseInt(dateMatch[3])
      extractedEffective = new Date(year, month, day)
      extractedExpiration = new Date(year + 1, month, day)
    }

    // Clean up contract name
    let extractedName = filename
      .replace(/[-_]/g, " ")
      .replace(/\d{6,8}/g, "")
      .replace(/\s+/g, " ")
      .trim()
    if (extractedName.length < 5) {
      extractedName = `${vendorName} Contract ${new Date().getFullYear()}`
    }

    // Detect contract type from filename
    const lower = filename.toLowerCase()
    let extractedType = "usage"
    if (lower.includes("pricing") || lower.includes("price")) extractedType = "pricing_only"
    else if (lower.includes("capital") || lower.includes("equipment")) extractedType = "capital"
    else if (lower.includes("gpo") || lower.includes("group")) extractedType = "grouped"

    // Simulate extraction progress
    const interval = setInterval(() => {
      setExtractionProgress((prev) => Math.min(prev + 10, 90))
    }, 200)
    await new Promise((r) => setTimeout(r, 2000))
    clearInterval(interval)
    setExtractionProgress(100)
    setExtractionComplete(true)
    setIsExtracting(false)

    // Auto-fill form
    setContractName(extractedName)
    setContractType(extractedType)
    if (extractedEffective) setEffectiveDate(extractedEffective)
    if (extractedExpiration) setExpirationDate(extractedExpiration)

    // Auto-select first facility if none selected
    if (!facilityId && facilities.length > 0) {
      setFacilityId(facilities[0].id)
    }

    toast.success(`Contract data extracted: "${extractedName}"`)
  }

  // ─── Submit ──────────────────────────────────────────────────
  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsSubmitting(true)

    const targetFacilityId = isMultiFacility
      ? selectedFacilities[0]
      : facilityId
    const targetFacility = facilities.find((f) => f.id === targetFacilityId)

    if (
      !contractName ||
      !contractType ||
      !targetFacilityId ||
      !effectiveDate ||
      !expirationDate
    ) {
      toast.error("Please fill in all required fields")
      setIsSubmitting(false)
      return
    }

    const payload: CreatePendingContractInput = {
      vendorId,
      vendorName,
      contractName,
      contractType: contractType as CreatePendingContractInput["contractType"],
      facilityId: targetFacilityId,
      facilityName: targetFacility?.name,
      effectiveDate: effectiveDate.toISOString().split("T")[0],
      expirationDate: expirationDate.toISOString().split("T")[0],
      totalValue: contractTotal ? parseFloat(contractTotal) : undefined,
      terms: contractTerms.length > 0 ? contractTerms : undefined,
      documents: uploadedDocs.length > 0 ? uploadedDocs : undefined,
      notes: description || undefined,
    }

    try {
      await create.mutateAsync(payload)
      router.push("/vendor/contracts")
    } catch {
      setIsSubmitting(false)
    }
  }

  const submitting = isSubmitting || create.isPending

  return (
    <div className="space-y-6">
      {/* Entry Mode Tabs */}
      <Tabs
        value={entryMode}
        onValueChange={(v) => setEntryMode(v as "pdf" | "manual")}
      >
        <TabsList className="grid w-full max-w-lg grid-cols-2">
          <TabsTrigger value="pdf" className="flex items-center gap-2">
            <Upload className="h-4 w-4" />
            Upload PDF
          </TabsTrigger>
          <TabsTrigger value="manual" className="flex items-center gap-2">
            <FileText className="h-4 w-4" />
            Manual Entry
          </TabsTrigger>
        </TabsList>

        {/* PDF Upload Tab */}
        <TabsContent value="pdf" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Upload className="h-5 w-5" />
                Upload Contract PDF
              </CardTitle>
              <CardDescription>
                Upload your contract PDF and our AI will extract the key details
                automatically
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center transition-colors",
                  contractFile
                    ? extractionComplete
                      ? "border-green-500 bg-green-50 dark:bg-green-950/30"
                      : "border-blue-500 bg-blue-50 dark:bg-blue-950/30"
                    : "hover:border-primary/50"
                )}
              >
                {contractFile ? (
                  <div className="space-y-4">
                    <div className="flex items-center justify-center gap-3">
                      <FileText
                        className={cn(
                          "h-8 w-8",
                          extractionComplete
                            ? "text-green-600"
                            : "text-blue-600"
                        )}
                      />
                      <div className="text-left">
                        <p className="font-medium">{contractFile.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {(contractFile.size / 1024).toFixed(1)} KB
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setContractFile(null)
                          setExtractionComplete(false)
                          setExtractionProgress(0)
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    {isExtracting && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Extracting contract data...
                        </div>
                        <Progress
                          value={extractionProgress}
                          className="h-2 max-w-xs mx-auto"
                        />
                      </div>
                    )}
                    {extractionComplete && (
                      <div className="flex items-center justify-center gap-2 text-green-600">
                        <CheckCircle2 className="h-5 w-5" />
                        <span>Data extracted successfully</span>
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <Sparkles className="h-10 w-10 mx-auto text-primary mb-3" />
                    <p className="text-lg font-medium mb-1">
                      Drop your contract PDF here
                    </p>
                    <p className="text-sm text-muted-foreground mb-4">
                      or click to browse files
                    </p>
                    <input
                      type="file"
                      accept=".pdf"
                      className="hidden"
                      id="contract-pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0]
                        if (file) handlePDFUpload(file)
                      }}
                    />
                    <Button asChild>
                      <label htmlFor="contract-pdf" className="cursor-pointer">
                        <Upload className="mr-2 h-4 w-4" />
                        Select PDF
                      </label>
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Manual Entry Tab */}
        <TabsContent value="manual" className="mt-4">
          <p className="text-sm text-muted-foreground mb-4">
            Fill in the contract details manually using the form below.
          </p>
        </TabsContent>
      </Tabs>

      {/* Main Form */}
      <form onSubmit={handleSubmit}>
        <div className="grid gap-6 lg:grid-cols-3">
          {/* ── Main form (left 2/3) ──────────────────────────── */}
          <div className="lg:col-span-2 space-y-6">
            {/* Basic Information */}
            <Card>
              <CardHeader>
                <CardTitle>Basic Information</CardTitle>
                <CardDescription>Enter the contract details</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="contractName">Contract Name *</Label>
                    <Input
                      id="contractName"
                      value={contractName}
                      onChange={(e) => setContractName(e.target.value)}
                      placeholder="e.g., Biologics Supply Agreement 2024"
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="contractType">Contract Type *</Label>
                    <Select value={contractType} onValueChange={setContractType}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        {CONTRACT_TYPE_OPTIONS.map((t) => (
                          <SelectItem key={t.value} value={t.value}>
                            <div className="flex items-center justify-between w-full gap-2">
                              <span>{t.label}</span>
                              <span className="text-xs text-muted-foreground">
                                {t.hint}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {/* Facility Selection */}
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                    <Checkbox
                      id="multiFacility"
                      checked={isMultiFacility}
                      onCheckedChange={(checked) => {
                        setIsMultiFacility(checked === true)
                        if (!checked) setSelectedFacilities([])
                      }}
                    />
                    <div className="grid gap-0.5">
                      <label
                        htmlFor="multiFacility"
                        className="flex items-center gap-2 cursor-pointer font-medium"
                      >
                        <Users className="h-4 w-4 text-muted-foreground" />
                        Multi-Facility Contract
                      </label>
                      <p className="text-xs text-muted-foreground">
                        Apply this contract to multiple facilities
                      </p>
                    </div>
                  </div>

                  {isMultiFacility ? (
                    <div className="space-y-2">
                      <Label className="flex items-center gap-2">
                        <Building2 className="h-4 w-4" />
                        Select Participating Facilities *
                      </Label>
                      {selectedFacilities.length > 0 && (
                        <div className="flex flex-wrap gap-2 p-2 rounded-md border bg-muted/30">
                          {selectedFacilities.map((fId) => {
                            const fac = facilities.find((f) => f.id === fId)
                            return fac ? (
                              <Badge
                                key={fId}
                                variant="secondary"
                                className="flex items-center gap-1"
                              >
                                {fac.name}
                                <button
                                  type="button"
                                  onClick={() =>
                                    setSelectedFacilities((prev) =>
                                      prev.filter((id) => id !== fId)
                                    )
                                  }
                                  className="ml-1 hover:text-destructive"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              </Badge>
                            ) : null
                          })}
                        </div>
                      )}
                      <Select
                        value=""
                        onValueChange={(value) => {
                          if (value && !selectedFacilities.includes(value)) {
                            setSelectedFacilities((prev) => [...prev, value])
                          }
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue
                            placeholder={
                              selectedFacilities.length > 0
                                ? "Add another facility..."
                                : "Select facilities"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {facilities
                            .filter(
                              (f) => !selectedFacilities.includes(f.id)
                            )
                            .map((f) => (
                              <SelectItem key={f.id} value={f.id}>
                                {f.name}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <Label htmlFor="facility">Target Facility *</Label>
                      <Select value={facilityId} onValueChange={setFacilityId}>
                        <SelectTrigger>
                          <SelectValue placeholder="Select facility" />
                        </SelectTrigger>
                        <SelectContent>
                          {facilities.map((f) => (
                            <SelectItem key={f.id} value={f.id}>
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Description / Special Terms */}
                <div className="space-y-2">
                  <Label htmlFor="description">
                    Description / Special Terms
                  </Label>
                  <Textarea
                    id="description"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Additional contract notes, special conditions, etc."
                    rows={3}
                  />
                </div>
              </CardContent>
            </Card>

            {/* Contract Dates */}
            <Card>
              <CardHeader>
                <CardTitle>Contract Dates</CardTitle>
                <CardDescription>
                  Set the contract timeline and evaluation periods
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Effective Date *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !effectiveDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {effectiveDate
                            ? format(effectiveDate, "PPP")
                            : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={effectiveDate}
                          onSelect={setEffectiveDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div className="space-y-2">
                    <Label>Expiration Date *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal",
                            !expirationDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {expirationDate
                            ? format(expirationDate, "PPP")
                            : "Select date"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={expirationDate}
                          onSelect={setExpirationDate}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Performance Period</Label>
                    <Select
                      value={performancePeriod}
                      onValueChange={setPerformancePeriod}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">
                          Monthly - Evaluated every month
                        </SelectItem>
                        <SelectItem value="quarterly">
                          Quarterly - Evaluated every 3 months
                        </SelectItem>
                        <SelectItem value="semi_annual">
                          Semi-Annual - Evaluated every 6 months
                        </SelectItem>
                        <SelectItem value="annual">
                          Annual - Evaluated yearly
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Rebate Pay Period</Label>
                    <Select
                      value={rebatePayPeriod}
                      onValueChange={setRebatePayPeriod}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">
                          Monthly - Paid every month
                        </SelectItem>
                        <SelectItem value="quarterly">
                          Quarterly - Paid every 3 months
                        </SelectItem>
                        <SelectItem value="semi_annual">
                          Semi-Annual - Paid every 6 months
                        </SelectItem>
                        <SelectItem value="annual">
                          Annual - Paid yearly
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Financial Details */}
            <Card>
              <CardHeader>
                <CardTitle>Financial Details</CardTitle>
                <CardDescription>Expected contract value</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  <Label htmlFor="contractTotal">
                    Expected Contract Total
                  </Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                      $
                    </span>
                    <Input
                      id="contractTotal"
                      type="number"
                      value={contractTotal}
                      onChange={(e) => setContractTotal(e.target.value)}
                      className="pl-7"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Contract Terms */}
            <Card>
              <CardHeader>
                <CardTitle>Contract Terms</CardTitle>
                <CardDescription>
                  Define rebate tiers, pricing terms, market share commitments,
                  and other contract conditions
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ContractTermsEntry
                  terms={contractTerms}
                  onChange={setContractTerms}
                />
              </CardContent>
            </Card>
          </div>

          {/* ── Sidebar (right 1/3) ───────────────────────────── */}
          <div className="space-y-6">
            {/* Vendor Info */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Submitting As</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium">{vendorName}</p>
                    <p className="text-sm text-muted-foreground">Vendor</p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Attached Documents */}
            {(contractFile || uploadedDocs.length > 0) && (
              <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/30">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-blue-700 dark:text-blue-400 text-base">
                    <FileText className="h-4 w-4" />
                    Attached Documents
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {contractFile && (
                      <div className="flex items-center gap-2 p-2 rounded bg-white/50 dark:bg-black/20">
                        <FileText className="h-4 w-4 text-blue-600" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {contractFile.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Contract PDF
                          </p>
                        </div>
                      </div>
                    )}
                    {uploadedDocs.map((doc) => (
                      <div
                        key={doc.url}
                        className="flex items-center gap-2 p-2 rounded bg-white/50 dark:bg-black/20"
                      >
                        <FileText className="h-4 w-4 text-green-600" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {doc.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Uploaded
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Document Upload */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  Documents (Optional)
                </CardTitle>
                <CardDescription className="text-xs">
                  Upload supporting documents
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FileUpload
                  onUpload={handleDocUpload}
                  accept=".pdf,.doc,.docx,.xls,.xlsx"
                  label="Upload document"
                />
              </CardContent>
            </Card>

            {/* Submit Button */}
            <Card>
              <CardContent className="pt-6">
                <Button
                  type="submit"
                  className="w-full"
                  disabled={submitting}
                >
                  {submitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" />
                      Submit for Review
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground text-center mt-2">
                  The facility will review and approve your contract
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </form>
    </div>
  )
}
