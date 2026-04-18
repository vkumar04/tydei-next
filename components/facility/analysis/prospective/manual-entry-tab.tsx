"use client"

/**
 * Manual-entry tab (spec §subsystem-3).
 *
 * Form with every field the scoring engine needs; on submit calls the same
 * `analyzeProposal` action as the upload path.
 */

import { useState } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Calculator, Loader2 } from "lucide-react"
import { toast } from "sonner"
import type { AnalyzeProposalInput } from "@/lib/actions/prospective-analysis"
import type { AnalysisPhase, ScoredProposal } from "./types"
import { useAnalyzeProspectiveProposal } from "./hooks"
import { ScoredProposalCard } from "./scored-proposal-card"

interface ManualEntryState {
  vendorName: string
  proposedAnnualSpend: number
  currentSpend: number
  priceVsMarket: number
  minimumSpend: number
  proposedRebateRate: number
  termYears: number
  exclusivity: boolean
  marketShareCommitment: number
  priceProtection: boolean
  paymentTermsNet60Or90: boolean
  volumeDiscountAbove5Percent: boolean
}

const INITIAL: ManualEntryState = {
  vendorName: "",
  proposedAnnualSpend: 500000,
  currentSpend: 500000,
  priceVsMarket: 0,
  minimumSpend: 400000,
  proposedRebateRate: 3,
  termYears: 3,
  exclusivity: false,
  marketShareCommitment: 0,
  priceProtection: false,
  paymentTermsNet60Or90: false,
  volumeDiscountAbove5Percent: false,
}

function toScoringInput(form: ManualEntryState): AnalyzeProposalInput {
  return {
    proposedAnnualSpend: form.proposedAnnualSpend,
    currentSpend: form.currentSpend,
    priceVsMarket: form.priceVsMarket,
    minimumSpend: form.minimumSpend,
    proposedRebateRate: form.proposedRebateRate,
    termYears: form.termYears,
    exclusivity: form.exclusivity,
    marketShareCommitment:
      form.marketShareCommitment > 0 ? form.marketShareCommitment : null,
    minimumSpendIsHighPct:
      form.currentSpend > 0 && form.minimumSpend > form.currentSpend * 0.8,
    priceProtection: form.priceProtection,
    paymentTermsNet60Or90: form.paymentTermsNet60Or90,
    volumeDiscountAbove5Percent: form.volumeDiscountAbove5Percent,
  }
}

interface ManualEntryTabProps {
  onProposalScored: (proposal: ScoredProposal) => void
  lastScored: ScoredProposal | null
  phase: AnalysisPhase
  onPhaseChange: (phase: AnalysisPhase) => void
}

export function ManualEntryTab({
  onProposalScored,
  lastScored,
  phase,
  onPhaseChange,
}: ManualEntryTabProps) {
  const [form, setForm] = useState<ManualEntryState>(INITIAL)
  const mutation = useAnalyzeProspectiveProposal()

  const set = <K extends keyof ManualEntryState>(
    key: K,
    value: ManualEntryState[K],
  ) => {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  const handleSubmit = async () => {
    onPhaseChange("analyzing")
    try {
      const input = toScoringInput(form)
      const result = await mutation.mutateAsync(input)
      const scored: ScoredProposal = {
        id: `man-${Date.now().toString(36)}`,
        vendorName: form.vendorName || "Manual proposal",
        createdAt: new Date().toISOString(),
        source: "manual",
        input,
        result,
        clauseAnalysis: null,
      }
      onProposalScored(scored)
      onPhaseChange("complete")
      toast.success("Proposal scored")
    } catch {
      onPhaseChange("error")
    }
  }

  const isBusy = phase === "analyzing" || mutation.isPending

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Manual proposal entry</CardTitle>
          <CardDescription>
            Enter proposal terms directly — same scoring engine as PDF upload.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="vendorName">Vendor name</Label>
            <Input
              id="vendorName"
              value={form.vendorName}
              onChange={(e) => set("vendorName", e.target.value)}
              placeholder="e.g., Arthrex"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="proposedAnnual">Proposed annual spend ($)</Label>
              <Input
                id="proposedAnnual"
                type="number"
                value={form.proposedAnnualSpend}
                onChange={(e) =>
                  set("proposedAnnualSpend", Number(e.target.value))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="currentSpend">Current baseline spend ($)</Label>
              <Input
                id="currentSpend"
                type="number"
                value={form.currentSpend}
                onChange={(e) => set("currentSpend", Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="priceVsMarket">
                Price vs market % (neg = cheaper)
              </Label>
              <Input
                id="priceVsMarket"
                type="number"
                step="0.5"
                value={form.priceVsMarket}
                onChange={(e) => set("priceVsMarket", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rebateRate">Proposed rebate rate (%)</Label>
              <Input
                id="rebateRate"
                type="number"
                step="0.1"
                value={form.proposedRebateRate}
                onChange={(e) =>
                  set("proposedRebateRate", Number(e.target.value))
                }
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="minimumSpend">Minimum spend commit ($)</Label>
              <Input
                id="minimumSpend"
                type="number"
                value={form.minimumSpend}
                onChange={(e) => set("minimumSpend", Number(e.target.value))}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="termYears">Term (years)</Label>
              <Input
                id="termYears"
                type="number"
                value={form.termYears}
                onChange={(e) => set("termYears", Number(e.target.value))}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="marketShare">
                Market-share commit (% — 0 = none)
              </Label>
              <Input
                id="marketShare"
                type="number"
                value={form.marketShareCommitment}
                onChange={(e) =>
                  set("marketShareCommitment", Number(e.target.value))
                }
              />
            </div>
            <div className="space-y-1.5 flex flex-col justify-end">
              <div className="flex items-center justify-between rounded-md border p-2">
                <Label htmlFor="exclusivity" className="text-sm font-normal">
                  Exclusivity
                </Label>
                <Switch
                  id="exclusivity"
                  checked={form.exclusivity}
                  onCheckedChange={(v) => set("exclusivity", v)}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label htmlFor="priceProt" className="text-sm font-normal">
                Price protection
              </Label>
              <Switch
                id="priceProt"
                checked={form.priceProtection}
                onCheckedChange={(v) => set("priceProtection", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label htmlFor="netTerms" className="text-sm font-normal">
                Net 60/90
              </Label>
              <Switch
                id="netTerms"
                checked={form.paymentTermsNet60Or90}
                onCheckedChange={(v) => set("paymentTermsNet60Or90", v)}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border p-2">
              <Label htmlFor="volDisc" className="text-sm font-normal">
                Volume disc &gt;5%
              </Label>
              <Switch
                id="volDisc"
                checked={form.volumeDiscountAbove5Percent}
                onCheckedChange={(v) => set("volumeDiscountAbove5Percent", v)}
              />
            </div>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={isBusy}>
            {isBusy ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Scoring…
              </>
            ) : (
              <>
                <Calculator className="mr-2 h-4 w-4" />
                Score proposal
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      <div>
        {lastScored && lastScored.source === "manual" ? (
          <ScoredProposalCard proposal={lastScored} />
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Scored proposal</CardTitle>
              <CardDescription>
                Fill the form and click &ldquo;Score proposal&rdquo; to see the
                output.
              </CardDescription>
            </CardHeader>
          </Card>
        )}
      </div>
    </div>
  )
}
