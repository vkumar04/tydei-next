"use client"

import { useState } from "react"
import { useMutation } from "@tanstack/react-query"
import { Sparkles, Loader2, Check } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import type { SupplyMatchResult } from "@/lib/ai/schemas"

interface ContractPricingItem {
  vendorItemNo: string
  description?: string
  unitPrice: number
}

interface AISupplyMatchProps {
  supplyName: string
  vendorItemNo?: string
  contractPricing: ContractPricingItem[]
  onMatch: (item: ContractPricingItem) => void
}

export function AISupplyMatch({
  supplyName,
  vendorItemNo,
  contractPricing,
  onMatch,
}: AISupplyMatchProps) {
  const [result, setResult] = useState<SupplyMatchResult | null>(null)

  const matchMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/match-supplies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ supplyName, vendorItemNo, contractPricing }),
      })
      if (!res.ok) throw new Error("Matching failed")
      return res.json() as Promise<SupplyMatchResult>
    },
    onSuccess: (data) => setResult(data),
  })

  if (result?.matchedVendorItemNo) {
    const matched = contractPricing.find(
      (p) => p.vendorItemNo === result.matchedVendorItemNo
    )

    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-between gap-4 pt-4">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">
              {result.matchedDescription ?? result.matchedVendorItemNo}
            </p>
            <p className="text-xs text-muted-foreground">{result.reasoning}</p>
            <Badge variant="secondary" className="mt-1">
              {Math.round(result.confidence * 100)}% confidence
            </Badge>
          </div>
          {matched && (
            <Button size="sm" onClick={() => onMatch(matched)}>
              <Check className="size-3" /> Accept
            </Button>
          )}
        </CardContent>
      </Card>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => matchMutation.mutate()}
      disabled={matchMutation.isPending}
    >
      {matchMutation.isPending ? (
        <Loader2 className="size-3 animate-spin" />
      ) : (
        <Sparkles className="size-3" />
      )}
      AI Match
    </Button>
  )
}
