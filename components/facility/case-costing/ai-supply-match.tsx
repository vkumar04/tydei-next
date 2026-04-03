"use client"

import { useState, useCallback } from "react"
import { useMutation } from "@tanstack/react-query"
import { Sparkles, Loader2, Check, PlayCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { toast } from "sonner"
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

interface BatchMatchProps {
  unmatchedSupplies: Array<{
    supplyName: string
    vendorItemNo?: string
  }>
  contractPricing: ContractPricingItem[]
  onBatchMatch: (
    results: Array<{
      supplyName: string
      matched: ContractPricingItem | null
      confidence: number
    }>
  ) => void
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

export function BatchSupplyMatch({
  unmatchedSupplies,
  contractPricing,
  onBatchMatch,
}: BatchMatchProps) {
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [processed, setProcessed] = useState(0)
  const [summary, setSummary] = useState<{
    matched: number
    total: number
  } | null>(null)

  const runBatch = useCallback(async () => {
    if (unmatchedSupplies.length === 0) {
      toast.info("No unmatched supplies to process")
      return
    }

    setIsRunning(true)
    setProgress(0)
    setProcessed(0)
    setSummary(null)

    const results: Array<{
      supplyName: string
      matched: ContractPricingItem | null
      confidence: number
    }> = []

    const total = unmatchedSupplies.length
    let matchedCount = 0

    for (let i = 0; i < total; i++) {
      const supply = unmatchedSupplies[i]
      try {
        const res = await fetch("/api/ai/match-supplies", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplyName: supply.supplyName,
            vendorItemNo: supply.vendorItemNo,
            contractPricing,
          }),
        })

        if (res.ok) {
          const data = (await res.json()) as SupplyMatchResult
          const matchedItem = data.matchedVendorItemNo
            ? contractPricing.find(
                (p) => p.vendorItemNo === data.matchedVendorItemNo
              ) ?? null
            : null

          if (matchedItem) matchedCount++

          results.push({
            supplyName: supply.supplyName,
            matched: matchedItem,
            confidence: data.confidence,
          })
        } else {
          results.push({
            supplyName: supply.supplyName,
            matched: null,
            confidence: 0,
          })
        }
      } catch {
        results.push({
          supplyName: supply.supplyName,
          matched: null,
          confidence: 0,
        })
      }

      setProcessed(i + 1)
      setProgress(Math.round(((i + 1) / total) * 100))

      // Small delay between calls to avoid rate limits
      if (i < total - 1) {
        await new Promise((resolve) => setTimeout(resolve, 300))
      }
    }

    setSummary({ matched: matchedCount, total })
    setIsRunning(false)
    onBatchMatch(results)
    toast.success(`Matched ${matchedCount} of ${total} supplies`)
  }, [unmatchedSupplies, contractPricing, onBatchMatch])

  if (summary) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-muted/50 px-4 py-3">
        <Check className="size-4 text-emerald-600 shrink-0" />
        <p className="text-sm">
          Matched{" "}
          <span className="font-semibold text-emerald-600">
            {summary.matched}
          </span>{" "}
          of {summary.total} supplies
        </p>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto gap-1.5"
          onClick={() => {
            setSummary(null)
            setProgress(0)
            setProcessed(0)
          }}
        >
          <Sparkles className="size-3" />
          Run Again
        </Button>
      </div>
    )
  }

  if (isRunning) {
    return (
      <div className="space-y-2 rounded-lg border bg-muted/50 px-4 py-3">
        <div className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            <Loader2 className="size-4 animate-spin text-primary" />
            Matching supplies...
          </span>
          <span className="text-muted-foreground">
            {processed} / {unmatchedSupplies.length}
          </span>
        </div>
        <Progress value={progress} className="h-2" />
      </div>
    )
  }

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={runBatch}
      disabled={unmatchedSupplies.length === 0}
    >
      <PlayCircle className="size-4" />
      Match All Unmatched ({unmatchedSupplies.length})
    </Button>
  )
}
