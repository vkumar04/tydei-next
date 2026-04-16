"use client"

import { useState, useCallback, useRef } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import {
  Upload,
  FileText,
  Loader2,
  X,
  Sparkles,
  Calculator,
  TrendingUp,
  DollarSign,
  Percent,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react"
import { toast } from "sonner"

interface ExtractedData {
  vendorName?: string
  capitalEquipment?: string
  contractValue: number
  contractYears: number
  annualSpend: number
  rebatePercent: number
  linkedCategories: string[]
}

interface UploadTabProps {
  onExtracted?: (data: {
    contractTotal?: number
    contractLength?: number
    rebatePercent?: number
  }) => void
  onNavigateToInputs?: () => void
  onNavigateToAnalysis?: () => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

export function UploadTab({ onExtracted, onNavigateToInputs, onNavigateToAnalysis }: UploadTabProps) {
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [extractedData, setExtractedData] = useState<ExtractedData | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleFile = useCallback(async (f: File) => {
    if (!f.type.includes("pdf")) {
      toast.error("Please upload a PDF file")
      return
    }
    setFile(f)
    setUploading(true)

    try {
      const formData = new FormData()
      formData.append("file", f)

      const res = await fetch("/api/ai/extract-contract", {
        method: "POST",
        body: formData,
      })

      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error((body as { error?: string } | null)?.error ?? "Failed to extract contract data")
      }

      const { extracted } = await res.json()

      const contractYears = extracted.effectiveDate && extracted.expirationDate
        ? Math.max(1, Math.round(
            (new Date(extracted.expirationDate).getTime() - new Date(extracted.effectiveDate).getTime()) /
            (365.25 * 24 * 60 * 60 * 1000)
          ))
        : 3
      const contractValue = extracted.totalValue ?? 0
      const rebatePercent = extracted.terms?.[0]?.tiers?.[0]?.rebateValue ?? 3.5

      setExtractedData({
        vendorName: extracted.vendorName ?? "Unknown Vendor",
        capitalEquipment: extracted.items?.[0]?.description ?? "Capital Equipment",
        contractValue,
        contractYears,
        annualSpend: contractYears > 0 ? contractValue / contractYears : 0,
        rebatePercent,
        linkedCategories: extracted.categories ?? [],
      })

      if (onExtracted) {
        onExtracted({
          contractTotal: contractValue || undefined,
          contractLength: contractYears || undefined,
          rebatePercent: rebatePercent || undefined,
        })
      }

      toast.success("Contract data extracted successfully")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed")
    } finally {
      setUploading(false)
    }
  }, [onExtracted])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }, [handleFile])

  const handleClear = () => {
    setFile(null)
    setExtractedData(null)
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle>Upload Capital Contract</CardTitle>
          <CardDescription>
            Upload a capital contract PDF to automatically extract and
            analyze financial terms
          </CardDescription>
        </CardHeader>
        <CardContent>
          {file && !uploading ? (
            <div className="flex flex-col items-center gap-3 p-6 rounded-lg border bg-muted/30 text-center">
              <CheckCircle2 className="h-10 w-10 text-green-500" />
              <p className="font-medium text-green-700 dark:text-green-400">{file.name}</p>
              <p className="text-sm text-muted-foreground">
                {extractedData ? "Analysis complete — review extracted data" : "File uploaded successfully"}
              </p>
              <Button variant="outline" size="sm" onClick={handleClear}>
                Upload Different File
              </Button>
            </div>
          ) : (
            <div
              className="border-2 border-dashed rounded-lg p-8 text-center border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50 transition-colors cursor-pointer"
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={handleDrop}
            >
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) handleFile(f)
                }}
              />
              <div className="space-y-3">
                <div className="flex justify-center">
                  {uploading ? (
                    <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  ) : (
                    <Upload className="h-10 w-10 text-muted-foreground" />
                  )}
                </div>
                {uploading ? (
                  <>
                    <p className="font-medium">Extracting contract data...</p>
                    <p className="text-sm text-muted-foreground">This may take a moment</p>
                  </>
                ) : (
                  <>
                    <p className="font-medium">Drag &amp; drop a capital contract PDF</p>
                    <p className="text-sm text-muted-foreground">or click to browse files</p>
                  </>
                )}
              </div>
            </div>
          )}

          <div className="rounded-lg bg-muted/50 p-4 mt-4">
            <h4 className="text-sm font-medium mb-2">AI will extract:</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              {[
                "Capital equipment value and payment terms",
                "Rebate tier structures and percentages",
                "Linked product categories and spend commitments",
                "Contract duration and key dates",
              ].map((item) => (
                <li key={item} className="flex items-center gap-2">
                  <CheckCircle2 className="h-3 w-3 text-primary shrink-0" />
                  {item}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Extracted Contract Data Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            Extracted Contract Data
          </CardTitle>
          <CardDescription>
            Review and edit AI-extracted values before analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          {extractedData ? (
            <div className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Vendor</Label>
                  <p className="font-medium">{extractedData.vendorName}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Capital Equipment</Label>
                  <p className="font-medium">{extractedData.capitalEquipment}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Contract Value</Label>
                  <p className="font-medium">{formatCurrency(extractedData.contractValue)}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Contract Length</Label>
                  <p className="font-medium">{extractedData.contractYears} Years</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Projected Annual Spend</Label>
                  <p className="font-medium">{formatCurrency(extractedData.annualSpend)}</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Rebate Rate</Label>
                  <p className="font-medium">{extractedData.rebatePercent}%</p>
                </div>
              </div>

              {extractedData.linkedCategories.length > 0 && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Linked Product Categories</Label>
                    <div className="flex flex-wrap gap-2">
                      {extractedData.linkedCategories.map((cat, i) => (
                        <Badge key={i} variant="secondary">{cat}</Badge>
                      ))}
                    </div>
                  </div>
                </>
              )}

              <Separator />

              <div className="flex gap-2">
                <Button className="flex-1 gap-2" onClick={onNavigateToAnalysis}>
                  <Calculator className="h-4 w-4" />
                  Run Financial Analysis
                </Button>
                <Button variant="outline" onClick={onNavigateToInputs}>
                  Edit Values
                </Button>
              </div>

              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground hover:text-destructive"
                onClick={handleClear}
              >
                Clear Analysis
              </Button>

              <p className="text-xs text-muted-foreground text-center">
                Values have been pre-filled in the Contract Inputs tab
              </p>
            </div>
          ) : (
            <div className="h-[300px] flex flex-col items-center justify-center text-muted-foreground">
              <FileText className="h-12 w-12 mb-3 opacity-30" />
              <p className="font-medium">No contract uploaded</p>
              <p className="text-sm">Upload a capital contract to see extracted data</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Analysis Insights */}
      {extractedData && (
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5" />
                Quick Analysis Insights
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/30 p-4 border border-blue-200 dark:border-blue-900">
                  <div className="flex items-center gap-2 mb-2">
                    <DollarSign className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-900 dark:text-blue-300">Payback Period</span>
                  </div>
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-400">
                    {extractedData.annualSpend > 0 && extractedData.rebatePercent > 0
                      ? `${Math.ceil(extractedData.contractValue / (extractedData.annualSpend * extractedData.rebatePercent / 100))} months`
                      : "N/A"}
                  </p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">Based on rebate offset</p>
                </div>
                <div className="rounded-lg bg-green-50 dark:bg-green-950/30 p-4 border border-green-200 dark:border-green-900">
                  <div className="flex items-center gap-2 mb-2">
                    <Percent className="h-4 w-4 text-green-600" />
                    <span className="font-medium text-green-900 dark:text-green-300">Total Rebate Potential</span>
                  </div>
                  <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                    {formatCurrency(extractedData.annualSpend * extractedData.contractYears * extractedData.rebatePercent / 100)}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-400">Over contract term</p>
                </div>
                <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-4 border border-amber-200 dark:border-amber-900">
                  <div className="flex items-center gap-2 mb-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <span className="font-medium text-amber-900 dark:text-amber-300">Capital Risk</span>
                  </div>
                  <p className="text-2xl font-bold text-amber-700 dark:text-amber-400">
                    {extractedData.contractValue > 500000 ? "Medium" : "Low"}
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {extractedData.contractValue > 500000
                      ? "High capital commitment"
                      : "Manageable capital commitment"}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
