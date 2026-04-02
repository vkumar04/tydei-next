"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { FileUpload } from "@/components/shared/file-upload"
import {
  Save,
  FileText,
  Upload,
  Trash2,
  Loader2,
  Building2,
  Layers,
} from "lucide-react"

export interface PricingFileData {
  total: number
  categories: string[]
  itemCount: number
}

export interface UploadedDoc {
  name: string
  url: string
}

export interface SubmissionSidebarProps {
  vendorName: string
  contractFile: File | null
  pricingFile: File | null
  pricingFileData: PricingFileData | null
  uploadedDocs: UploadedDoc[]
  submitting: boolean
  onClearPricingFile: () => void
  onPricingFileSelect: (file: File) => void
  onDocUpload: (file: File) => Promise<string>
}

export function SubmissionSidebar({
  vendorName,
  contractFile,
  pricingFile,
  pricingFileData,
  uploadedDocs,
  submitting,
  onClearPricingFile,
  onPricingFileSelect,
  onDocUpload,
}: SubmissionSidebarProps) {
  return (
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
      {(contractFile || pricingFile || uploadedDocs.length > 0) && (
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
              {pricingFile && (
                <div className="flex items-center gap-2 p-2 rounded bg-white/50 dark:bg-black/20">
                  <Layers className="h-4 w-4 text-purple-600 dark:text-purple-400" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">
                      {pricingFile.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Pricing File
                    </p>
                  </div>
                </div>
              )}
              {uploadedDocs.map((doc) => (
                <div
                  key={doc.url}
                  className="flex items-center gap-2 p-2 rounded bg-white/50 dark:bg-black/20"
                >
                  <FileText className="h-4 w-4 text-green-600 dark:text-green-400" />
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

      {/* Pricing File Upload */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Pricing File
            <Badge variant="outline" className="text-xs font-normal">Optional</Badge>
          </CardTitle>
          <CardDescription className="text-xs">
            Upload a pricing schedule (CSV or Excel)
          </CardDescription>
        </CardHeader>
        <CardContent>
          {pricingFile ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                <FileText className="h-4 w-4 text-primary shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{pricingFile.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {(pricingFile.size / 1024).toFixed(1)} KB
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onClearPricingFile}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
              {pricingFileData && (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Items</span>
                    <span className="font-medium">{pricingFileData.itemCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Value</span>
                    <span className="font-medium text-green-600 dark:text-green-400">
                      ${pricingFileData.total.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </span>
                  </div>
                  {pricingFileData.categories.length > 0 && (
                    <div className="space-y-1">
                      <span className="text-muted-foreground text-xs">Categories</span>
                      <div className="flex flex-wrap gap-1">
                        {pricingFileData.categories.slice(0, 5).map((cat) => (
                          <Badge key={cat} variant="secondary" className="text-xs">
                            {cat}
                          </Badge>
                        ))}
                        {pricingFileData.categories.length > 5 && (
                          <Badge variant="outline" className="text-xs">
                            +{pricingFileData.categories.length - 5} more
                          </Badge>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <div
                className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer hover:border-primary/50 transition-colors"
                onClick={() => document.getElementById("pricing-file")?.click()}
              >
                <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-1" />
                <p className="text-xs text-muted-foreground">
                  Drop pricing file or click to browse
                </p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  CSV, Excel (.xlsx, .xls)
                </p>
              </div>
              <input
                type="file"
                id="pricing-file"
                accept=".csv,.xlsx,.xls"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  if (file) onPricingFileSelect(file)
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>

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
            onUpload={onDocUpload}
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
  )
}
