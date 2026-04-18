"use client"

/**
 * Pricing tab — the 4th tab (Upload / Manual / Proposals / Pricing / Compare).
 *
 * Composes the pricing-file upload dropzone + a list of all prior in-session
 * pricing analyses. The upload sub-component already renders the most
 * recent analysis in detail; this wrapper adds a picker for older ones.
 */

import { useMemo, useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { FileSpreadsheet } from "lucide-react"
import type { PricingFileAnalysisRecord, VendorOption } from "./types"
import { UploadPricingTab } from "./upload-pricing-tab"

interface PricingTabProps {
  vendors: VendorOption[]
  selectedVendorId: string | null
  onVendorChange: (vendorId: string | null) => void
  onAnalysisComplete: (record: PricingFileAnalysisRecord) => void
  analyses: PricingFileAnalysisRecord[]
}

export function PricingTab({
  vendors,
  selectedVendorId,
  onVendorChange,
  onAnalysisComplete,
  analyses,
}: PricingTabProps) {
  const [activeId, setActiveId] = useState<string | null>(
    analyses[0]?.id ?? null,
  )

  // Keep activeId in sync when the list changes — always show the newest
  // when no explicit pick.
  const active = useMemo(() => {
    if (activeId) {
      const found = analyses.find((a) => a.id === activeId)
      if (found) return found
    }
    return analyses[0] ?? null
  }, [activeId, analyses])

  return (
    <div className="space-y-6">
      <UploadPricingTab
        vendors={vendors}
        selectedVendorId={selectedVendorId}
        onVendorChange={onVendorChange}
        onAnalysisComplete={(r) => {
          onAnalysisComplete(r)
          setActiveId(r.id)
        }}
        lastAnalysis={active}
      />

      {analyses.length > 1 ? (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileSpreadsheet className="h-4 w-4" />
              Prior analyses in this session
            </CardTitle>
            <CardDescription>
              Click to switch the active results display above.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {analyses.map((a) => {
                const isActive = active?.id === a.id
                return (
                  <Button
                    key={a.id}
                    variant={isActive ? "default" : "outline"}
                    size="sm"
                    onClick={() => setActiveId(a.id)}
                  >
                    {a.fileName}
                    {a.vendorName ? (
                      <span className="ml-1 text-xs opacity-70">
                        · {a.vendorName}
                      </span>
                    ) : null}
                  </Button>
                )
              })}
            </div>
          </CardContent>
        </Card>
      ) : null}
    </div>
  )
}
