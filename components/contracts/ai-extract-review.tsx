"use client"

import { useState } from "react"
import { Check, Pencil } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { ExtractedContractData } from "@/lib/ai/schemas"

interface AIExtractReviewProps {
  extracted: ExtractedContractData
  confidence: number
  onAccept: (data: ExtractedContractData) => void
}

const FIELD_LABELS: Record<string, string> = {
  contractName: "Contract Name",
  vendorName: "Vendor",
  contractType: "Type",
  effectiveDate: "Effective Date",
  expirationDate: "Expiration Date",
  totalValue: "Total Value",
  description: "Description",
}

export function AIExtractReview({
  extracted,
  confidence,
  onAccept,
}: AIExtractReviewProps) {
  const [data, setData] = useState(extracted)
  const [editField, setEditField] = useState<string | null>(null)

  function updateField(field: string, value: string) {
    setData((prev) => ({ ...prev, [field]: value }))
    setEditField(null)
  }

  const confidenceLabel = confidence >= 0.8 ? "High" : confidence >= 0.5 ? "Medium" : "Low"
  const confidenceVariant =
    confidence >= 0.8 ? "default" : confidence >= 0.5 ? "secondary" : "destructive"

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Review extracted data before accepting
        </p>
        <Badge variant={confidenceVariant}>
          {confidenceLabel} confidence ({Math.round(confidence * 100)}%)
        </Badge>
      </div>

      <Card>
        <CardContent className="divide-y pt-4">
          {Object.entries(FIELD_LABELS).map(([key, label]) => {
            const value = String(data[key as keyof ExtractedContractData] ?? "")
            const isEditing = editField === key

            return (
              <div
                key={key}
                className="flex items-center justify-between gap-4 py-2"
              >
                <span className="text-sm font-medium">{label}</span>
                {isEditing ? (
                  <Input
                    defaultValue={value}
                    className="max-w-xs"
                    autoFocus
                    onBlur={(e) => updateField(key, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") updateField(key, e.currentTarget.value)
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">
                      {value || "—"}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={() => setEditField(key)}
                    >
                      <Pencil className="size-3" />
                    </Button>
                  </div>
                )}
              </div>
            )
          })}
        </CardContent>
      </Card>

      {data.terms.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <p className="mb-2 text-sm font-medium">
              Terms ({data.terms.length})
            </p>
            {data.terms.map((term, i) => (
              <div key={i} className="mb-2 rounded border p-2 text-xs">
                <span className="font-medium">{term.termName}</span>
                <span className="text-muted-foreground">
                  {" "}— {term.termType} — {term.tiers.length} tier(s)
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <Button className="w-full" onClick={() => onAccept(data)}>
        <Check className="size-4" /> Accept & Populate Form
      </Button>
    </div>
  )
}
