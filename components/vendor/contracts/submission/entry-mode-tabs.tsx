"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Upload,
  FileText,
  FileSpreadsheet,
  Sparkles,
  CheckCircle2,
  Trash2,
  Loader2,
  Plus,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { AIExtractDialog } from "@/components/contracts/ai-extract-dialog"
import { AITextExtract } from "@/components/contracts/ai-text-extract"
import type { ExtractedContractData } from "@/lib/ai/schemas"

export interface EntryModeTabsProps {
  entryMode: "ai" | "pdf" | "manual"
  onEntryModeChange: (mode: "ai" | "pdf" | "manual") => void
  contractFile: File | null
  isExtracting: boolean
  extractionProgress: number
  extractionComplete: boolean
  onPDFUpload: (file: File) => void
  onClearPDF: () => void
  onAIExtracted?: (data: ExtractedContractData, s3Key?: string, fileName?: string) => void
  additionalDocs?: { file: File; type: string; name: string }[]
  onAddDoc?: (file: File, type: string) => void
  onRemoveDoc?: (index: number) => void
  onChangeDocType?: (index: number, type: string) => void
  pricingFileName?: string | null
  pricingItemCount?: number
  onPricingUpload?: (file: File) => void
  onClearPricing?: () => void
}

export function EntryModeTabs({
  entryMode,
  onEntryModeChange,
  contractFile,
  isExtracting,
  extractionProgress,
  extractionComplete,
  onPDFUpload,
  onClearPDF,
  onAIExtracted,
  additionalDocs = [],
  onAddDoc,
  onRemoveDoc,
  onChangeDocType,
  pricingFileName,
  pricingItemCount,
  onPricingUpload,
  onClearPricing,
}: EntryModeTabsProps) {
  return (
    <Tabs
      value={entryMode}
      onValueChange={(v) => onEntryModeChange(v as "ai" | "pdf" | "manual")}
    >
      <TabsList className="grid w-full max-w-lg grid-cols-3">
        <TabsTrigger value="ai" className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" />
          AI Assistant
        </TabsTrigger>
        <TabsTrigger value="pdf" className="flex items-center gap-2">
          <Upload className="h-4 w-4" />
          Upload PDF
        </TabsTrigger>
        <TabsTrigger value="manual" className="flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Manual Entry
        </TabsTrigger>
      </TabsList>

      {/* AI Assistant Tab */}
      <TabsContent value="ai" className="mt-4 space-y-4">
        <AIAssistantTabContent onAIExtracted={onAIExtracted} />
      </TabsContent>

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
                          ? "text-green-600 dark:text-green-400"
                          : "text-blue-600 dark:text-blue-400"
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
                      onClick={onClearPDF}
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
                    <div className="flex items-center justify-center gap-2 text-green-600 dark:text-green-400">
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
                      if (file) onPDFUpload(file)
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

        {/* Additional Documents */}
        {onAddDoc && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-5 w-5" />
                Additional Documents
              </CardTitle>
              <CardDescription>
                Upload amendments, addendums, or exhibits
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {additionalDocs.length > 0 && (
                <div className="space-y-2">
                  {additionalDocs.map((doc, i) => (
                    <div key={i} className="flex items-center justify-between p-2 rounded-lg border">
                      <div className="flex items-center gap-2 min-w-0">
                        <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="text-sm truncate">{doc.name}</span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Select value={doc.type} onValueChange={(v) => onChangeDocType?.(i, v)}>
                          <SelectTrigger className="h-7 w-[120px] text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="amendment">Amendment</SelectItem>
                            <SelectItem value="addendum">Addendum</SelectItem>
                            <SelectItem value="exhibit">Exhibit</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onRemoveDoc?.(i)}>
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const input = document.createElement("input")
                  input.type = "file"
                  input.accept = ".pdf,.doc,.docx,.txt"
                  input.onchange = (e) => {
                    const file = (e.target as HTMLInputElement).files?.[0]
                    if (file) onAddDoc(file, "amendment")
                  }
                  input.click()
                }}
              >
                <Plus className="h-4 w-4 mr-1" /> Add Document
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Pricing File */}
        {onPricingUpload && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileSpreadsheet className="h-5 w-5" />
                Upload Pricing File
              </CardTitle>
              <CardDescription>
                Upload a CSV or Excel file with vendor item numbers and pricing
              </CardDescription>
            </CardHeader>
            <CardContent>
              {pricingFileName ? (
                <div className="flex items-center justify-between p-3 rounded-lg border bg-emerald-50 dark:bg-emerald-950/30 border-emerald-200 dark:border-emerald-900">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                    <div>
                      <p className="text-sm font-medium">{pricingFileName}</p>
                      <p className="text-xs text-muted-foreground">{pricingItemCount} pricing items loaded</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{pricingItemCount} items</Badge>
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClearPricing}>
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  variant="outline"
                  onClick={() => {
                    const input = document.createElement("input")
                    input.type = "file"
                    input.accept = ".csv,.xlsx,.xls"
                    input.onchange = (e) => {
                      const file = (e.target as HTMLInputElement).files?.[0]
                      if (file) onPricingUpload(file)
                    }
                    input.click()
                  }}
                >
                  <Upload className="h-4 w-4 mr-2" /> Upload Pricing File
                </Button>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      {/* Manual Entry Tab */}
      <TabsContent value="manual" className="mt-4">
        <p className="text-sm text-muted-foreground mb-4">
          Fill in the contract details manually using the form below.
        </p>
      </TabsContent>
    </Tabs>
  )
}

/** Inner component for the AI tab content to keep the main component clean */
function AIAssistantTabContent({
  onAIExtracted,
}: {
  onAIExtracted?: (data: ExtractedContractData, s3Key?: string, fileName?: string) => void
}) {
  const [aiExtractOpen, setAiExtractOpen] = useState(false)

  return (
    <>
      <AIExtractDialog
        open={aiExtractOpen}
        onOpenChange={setAiExtractOpen}
        onExtracted={(data, s3Key, fileName) => {
          onAIExtracted?.(data, s3Key, fileName)
          setAiExtractOpen(false)
        }}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5" />
            AI Contract Extraction
          </CardTitle>
          <CardDescription>
            Upload a contract PDF and AI will extract the key fields
            automatically
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-center gap-4 py-8">
          <p className="text-sm text-muted-foreground">
            Upload a contract document and AI will extract all the relevant
            details.
          </p>
          <Button onClick={() => setAiExtractOpen(true)}>
            <Sparkles className="mr-2 h-4 w-4" />
            Start AI Extraction
          </Button>
        </CardContent>
      </Card>

      <AITextExtract
        onExtracted={(data) => {
          onAIExtracted?.(data)
        }}
      />
    </>
  )
}
