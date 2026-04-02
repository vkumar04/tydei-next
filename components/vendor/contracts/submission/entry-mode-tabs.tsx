"use client"

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
  Sparkles,
  CheckCircle2,
  Trash2,
  Loader2,
} from "lucide-react"

export interface EntryModeTabsProps {
  entryMode: "pdf" | "manual"
  onEntryModeChange: (mode: "pdf" | "manual") => void
  contractFile: File | null
  isExtracting: boolean
  extractionProgress: number
  extractionComplete: boolean
  onPDFUpload: (file: File) => void
  onClearPDF: () => void
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
}: EntryModeTabsProps) {
  return (
    <Tabs
      value={entryMode}
      onValueChange={(v) => onEntryModeChange(v as "pdf" | "manual")}
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
