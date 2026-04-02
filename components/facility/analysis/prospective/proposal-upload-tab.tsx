"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Upload,
  CheckCircle2,
  FileUp,
  Pencil,
  Calculator,
  Loader2,
} from "lucide-react"

interface ManualEntryState {
  vendorName: string
  productCategory: string
  totalValue: number
  contractLength: number
  baseDiscount: number
  rebatePercent: number
  minimumSpend: number
  marketShare: number
}

export interface ProposalUploadTabProps {
  onFileUpload: (file: File) => void
  isDragging: boolean
  onDragOver: (e: React.DragEvent) => void
  onDragLeave: () => void
  onDrop: (e: React.DragEvent) => void
  isAnalyzing: boolean
  manualEntry: ManualEntryState
  onManualEntryChange: (entry: ManualEntryState) => void
}

export function ProposalUploadTab({
  onFileUpload,
  isDragging,
  onDragOver,
  onDragLeave,
  onDrop,
  isAnalyzing,
  manualEntry,
  onManualEntryChange,
}: ProposalUploadTabProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* File Upload */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Upload Contract Document
          </CardTitle>
          <CardDescription>
            Upload a vendor proposal or contract PDF for AI-powered
            analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-primary/50"
            }`}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onDrop={onDrop}
            onClick={() => {
              const input = document.createElement("input")
              input.type = "file"
              input.accept = ".csv"
              input.onchange = (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) onFileUpload(file)
              }
              input.click()
            }}
          >
            {isAnalyzing ? (
              <div className="space-y-4">
                <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin" />
                <p className="text-muted-foreground">
                  Analyzing contract terms...
                </p>
              </div>
            ) : (
              <>
                <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                <p className="font-medium">
                  Drag &amp; drop a contract PDF
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or click to browse files
                </p>
              </>
            )}
          </div>

          <div className="mt-4 p-4 bg-muted/50 rounded-lg">
            <p className="text-sm font-medium mb-2">AI will extract:</p>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Rebate tier structures and percentages
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Pricing terms and discounts
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Commitment requirements
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                Contract duration and key dates
              </li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Manual Entry */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5" />
            Manual Entry
          </CardTitle>
          <CardDescription>
            Enter contract details manually to analyze
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Vendor Name</Label>
              <Input
                value={manualEntry.vendorName}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    vendorName: e.target.value,
                  })
                }
                placeholder="e.g., Arthrex"
              />
            </div>
            <div className="space-y-2">
              <Label>Product Category</Label>
              <Select
                value={manualEntry.productCategory}
                onValueChange={(v) =>
                  onManualEntryChange({
                    ...manualEntry,
                    productCategory: v,
                  })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Orthopedics">
                    Orthopedics
                  </SelectItem>
                  <SelectItem value="Cardiovascular">
                    Cardiovascular
                  </SelectItem>
                  <SelectItem value="General Surgery">
                    General Surgery
                  </SelectItem>
                  <SelectItem value="Spine">Spine</SelectItem>
                  <SelectItem value="Trauma">Trauma</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Total Contract Value</Label>
              <Input
                type="number"
                value={manualEntry.totalValue}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    totalValue: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Contract Length (years)</Label>
              <Input
                type="number"
                value={manualEntry.contractLength}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    contractLength: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Base Discount (%)</Label>
              <Input
                type="number"
                value={manualEntry.baseDiscount}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    baseDiscount: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Rebate (%)</Label>
              <Input
                type="number"
                value={manualEntry.rebatePercent}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    rebatePercent: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Minimum Spend Commitment</Label>
              <Input
                type="number"
                value={manualEntry.minimumSpend}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    minimumSpend: Number(e.target.value),
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label>Market Share Commitment (%)</Label>
              <Input
                type="number"
                value={manualEntry.marketShare}
                onChange={(e) =>
                  onManualEntryChange({
                    ...manualEntry,
                    marketShare: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <Button className="w-full">
            <Calculator className="h-4 w-4 mr-2" />
            Analyze Proposal
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
