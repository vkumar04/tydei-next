"use client"

import { useState, useRef } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, FileSpreadsheet } from "lucide-react"
import { useAnalyzeProposal } from "@/hooks/use-prospective"
import type { ProposalAnalysis, ProposedPricingItem } from "@/lib/actions/prospective"

interface ProposalUploadProps {
  facilityId: string
  onAnalyzed: (result: ProposalAnalysis) => void
}

export function ProposalUpload({ facilityId, onAnalyzed }: ProposalUploadProps) {
  const [file, setFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const mutation = useAnalyzeProposal()

  async function handleAnalyze() {
    if (!file) return

    const text = await file.text()
    const lines = text.split("\n").filter((l) => l.trim())
    const headers = lines[0]?.split(",").map((h) => h.trim().toLowerCase()) ?? []

    const items: ProposedPricingItem[] = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim())
      const get = (key: string) => vals[headers.indexOf(key)] ?? ""
      return {
        vendorItemNo: get("item_no") || get("vendor_item_no") || get("sku"),
        description: get("description") || get("desc") || undefined,
        proposedPrice: parseFloat(get("proposed_price") || get("price") || "0"),
        currentPrice: parseFloat(get("current_price") || "0") || undefined,
        quantity: parseInt(get("quantity") || get("qty") || "1") || undefined,
      }
    })

    const result = await mutation.mutateAsync({
      facilityId,
      proposedPricing: items,
    })
    onAnalyzed(result)
    setFile(null)
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Upload Vendor Proposal</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <input
          ref={inputRef}
          type="file"
          accept=".csv"
          className="hidden"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        {file ? (
          <div className="flex items-center gap-2 rounded-md border p-3">
            <FileSpreadsheet className="size-5 text-muted-foreground" />
            <span className="flex-1 truncate text-sm">{file.name}</span>
            <Button variant="ghost" size="sm" onClick={() => setFile(null)}>
              Remove
            </Button>
          </div>
        ) : (
          <Button variant="outline" onClick={() => inputRef.current?.click()}>
            <Upload className="size-4" /> Select pricing CSV
          </Button>
        )}
        <Button onClick={handleAnalyze} disabled={!file || mutation.isPending}>
          {mutation.isPending ? "Analyzing..." : "Analyze Proposal"}
        </Button>
      </CardContent>
    </Card>
  )
}
