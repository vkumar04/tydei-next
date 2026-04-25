"use client"

import { useState } from "react"
import type { PendingContract, Vendor } from "@prisma/client"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { toDisplayRebateValue } from "@/lib/contracts/rebate-value-normalize"
import { Loader2 } from "lucide-react"

type PendingContractWithVendor = PendingContract & {
  vendor: Pick<Vendor, "id" | "name" | "logoUrl">
}

interface PendingReviewDialogProps {
  contract: PendingContractWithVendor
  open: boolean
  onOpenChange: (open: boolean) => void
  onApprove: () => void
  onReject: (notes: string) => void
  onRequestRevision: (notes: string) => void
  isSubmitting: boolean
}

interface PendingTermLike {
  termName?: string
  termType?: string
  baselineType?: string
  evaluationPeriod?: string
  paymentTiming?: string
  spendBaseline?: number | string | null
  growthBaselinePercent?: number | string | null
  cptCodes?: string[]
  tiers?: Array<{
    tierNumber?: number
    tierName?: string | null
    spendMin?: number | string | null
    spendMax?: number | string | null
    volumeMin?: number | string | null
    volumeMax?: number | string | null
    marketShareMin?: number | string | null
    marketShareMax?: number | string | null
    rebateType?: string
    rebateValue?: number | string
  }>
}

/**
 * Charles 2026-04-25 audit pass-2 C1: pre-mirror reviewer view.
 *
 * Vendor-submitted volume_rebate / market_share contracts populate
 * `volumeMin/Max` / `marketShareMin/Max` directly. The mirror to
 * `spendMin/Max` only happens at `extractPendingTerms` (during
 * approve). The reviewer's pending-review dialog runs PRE-approve,
 * so reading only `spendMin` would render "0%+" for a tier the
 * vendor actually configured at 80%. Pick the right column per
 * termType so the reviewer sees what they're approving.
 */
function readTierMin(
  termType: string | undefined,
  tier: NonNullable<PendingTermLike["tiers"]>[number],
): number | string | null | undefined {
  switch (termType) {
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
    case "po_rebate":
    case "payment_rebate":
      return tier.volumeMin ?? tier.spendMin
    case "compliance_rebate":
    case "market_share":
      return tier.marketShareMin ?? tier.spendMin
    default:
      return tier.spendMin
  }
}
function readTierMax(
  termType: string | undefined,
  tier: NonNullable<PendingTermLike["tiers"]>[number],
): number | string | null | undefined {
  switch (termType) {
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
    case "po_rebate":
    case "payment_rebate":
      return tier.volumeMax ?? tier.spendMax
    case "compliance_rebate":
    case "market_share":
      return tier.marketShareMax ?? tier.spendMax
    default:
      return tier.spendMax
  }
}

/**
 * Charles 2026-04-25 audit re-pass F4 — tier-threshold formatter.
 *
 * Threshold columns (`spendMin` / `spendMax`) are interpreted by the
 * engine differently per termType. Without a unit cue, a reviewer
 * looking at "95+ → $1,000" can't tell if 95 is dollars, percent,
 * occurrences, etc. Returns a unit-aware formatted threshold.
 */
function formatTierThreshold(
  termType: string | undefined,
  spendMin: number | string | null | undefined,
  spendMax: number | string | null | undefined,
): string {
  // Charles audit pass-2 C1: signature already accepts null; callers
  // now pre-pick the correct column per termType (volume*/marketShare*
  // mirror to spend* only at extract time).
  const min = Number(spendMin ?? 0).toLocaleString()
  const max = spendMax != null ? Number(spendMax).toLocaleString() : null
  switch (termType) {
    case "compliance_rebate":
    case "market_share":
      return max != null ? `${min}%–${max}%` : `${min}%+`
    case "volume_rebate":
    case "rebate_per_use":
    case "capitated_pricing_rebate":
      return max != null ? `${min}–${max} ev` : `${min}+ ev`
    case "po_rebate":
      return max != null ? `${min}–${max} POs` : `${min}+ POs`
    case "payment_rebate":
      return max != null ? `${min}–${max} invoices` : `${min}+ invoices`
    default:
      // Spend-shaped threshold (spend_rebate, growth_rebate, fixed_fee, …).
      return max != null ? `$${min}–$${max}` : `$${min}+`
  }
}

function PendingTermsSection({ terms }: { terms: unknown }) {
  if (!Array.isArray(terms) || terms.length === 0) return null
  const rows = terms as PendingTermLike[]
  return (
    <div className="space-y-2 border-t pt-3">
      <p className="text-sm font-medium">Rebate Terms ({rows.length})</p>
      <div className="space-y-3">
        {rows.map((t, i) => (
          <div key={i} className="rounded-md border p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-sm">
                {t.termName || `Term ${i + 1}`}
              </span>
              {t.termType && (
                <Badge variant="outline" className="text-[10px] capitalize">
                  {t.termType.replace(/_/g, " ")}
                </Badge>
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {[t.baselineType, t.evaluationPeriod, t.paymentTiming]
                .filter(Boolean)
                .map((s) => String(s).replace(/_/g, " "))
                .join(" · ")}
            </div>
            {t.cptCodes && t.cptCodes.length > 0 && (
              <div className="mt-1 text-xs">
                <span className="text-muted-foreground">CPT:</span>{" "}
                {t.cptCodes.join(", ")}
              </div>
            )}
            {Array.isArray(t.tiers) && t.tiers.length > 0 && (
              <div className="mt-2 space-y-1">
                {t.tiers.map((tier, j) => (
                  <div
                    key={j}
                    className="flex items-baseline justify-between gap-2 text-xs tabular-nums"
                  >
                    <span className="text-muted-foreground">
                      Tier {tier.tierNumber ?? j + 1}
                      {tier.tierName ? ` · ${tier.tierName}` : ""}
                    </span>
                    <span>
                      {formatTierThreshold(t.termType, readTierMin(t.termType, tier), readTierMax(t.termType, tier))}
                      {" → "}
                      <span className="font-medium">
                        {tier.rebateType === "fixed_rebate" ||
                        tier.rebateType === "fixed_rebate_per_unit"
                          ? formatCurrency(Number(tier.rebateValue ?? 0))
                          : `${toDisplayRebateValue(
                              tier.rebateType ?? "percent_of_spend",
                              Number(tier.rebateValue ?? 0),
                            ).toFixed(2)}%`}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

export function PendingReviewDialog({
  contract, open, onOpenChange, onApprove, onReject, onRequestRevision, isSubmitting,
}: PendingReviewDialogProps) {
  const [tab, setTab] = useState("details")
  const [notes, setNotes] = useState("")

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Review: {contract.contractName}
            <Badge variant="secondary">Pending</Badge>
          </DialogTitle>
        </DialogHeader>

        <Tabs
          value={tab}
          onValueChange={setTab}
          className="flex min-h-0 flex-1 flex-col"
        >
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="action">Action</TabsTrigger>
          </TabsList>

          <TabsContent
            value="details"
            className="min-h-0 flex-1 space-y-3 overflow-y-auto text-sm"
          >
            <div className="flex justify-between"><span className="text-muted-foreground">Vendor</span><span>{contract.vendor.name}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{contract.contractType.replace("_", " ")}</span></div>
            {contract.effectiveDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Effective</span><span>{formatCalendarDate(contract.effectiveDate)}</span></div>
            )}
            {contract.expirationDate && (
              <div className="flex justify-between"><span className="text-muted-foreground">Expiration</span><span>{formatCalendarDate(contract.expirationDate)}</span></div>
            )}
            {contract.totalValue && (
              <div className="flex justify-between"><span className="text-muted-foreground">Value</span><span>{formatCurrency(Number(contract.totalValue))}</span></div>
            )}
            {/*
             * Charles 2026-04-25 (audit follow-up — vendor-mirror
             * Phase 2): surface the field-parity columns the vendor
             * may have submitted so the facility approver can see
             * everything they're approving. Each row is conditional
             * on the field being set so the dialog doesn't bloat
             * with empty rows on legacy submissions.
             */}
            {contract.contractNumber && (
              <div className="flex justify-between"><span className="text-muted-foreground">Contract #</span><span>{contract.contractNumber}</span></div>
            )}
            {contract.annualValue != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Annual Value</span><span>{formatCurrency(Number(contract.annualValue))}</span></div>
            )}
            {contract.gpoAffiliation && (
              <div className="flex justify-between"><span className="text-muted-foreground">GPO</span><span>{contract.gpoAffiliation}</span></div>
            )}
            {contract.performancePeriod && (
              <div className="flex justify-between"><span className="text-muted-foreground">Performance period</span><span className="capitalize">{contract.performancePeriod}</span></div>
            )}
            {contract.rebatePayPeriod && (
              <div className="flex justify-between"><span className="text-muted-foreground">Rebate pay period</span><span className="capitalize">{contract.rebatePayPeriod}</span></div>
            )}
            {contract.autoRenewal && (
              <div className="flex justify-between"><span className="text-muted-foreground">Auto-renewal</span><span>Yes</span></div>
            )}
            {contract.terminationNoticeDays != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Termination notice</span><span>{contract.terminationNoticeDays} days</span></div>
            )}
            {contract.capitalCost != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Capital cost</span><span>{formatCurrency(Number(contract.capitalCost))}</span></div>
            )}
            {contract.interestRate != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Interest rate</span><span>{(Number(contract.interestRate) * 100).toFixed(2)}%</span></div>
            )}
            {contract.termMonths != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Term</span><span>{contract.termMonths} months</span></div>
            )}
            {contract.downPayment != null && (
              <div className="flex justify-between"><span className="text-muted-foreground">Down payment</span><span>{formatCurrency(Number(contract.downPayment))}</span></div>
            )}
            {contract.paymentCadence && (
              <div className="flex justify-between"><span className="text-muted-foreground">Payment cadence</span><span className="capitalize">{contract.paymentCadence}</span></div>
            )}
            {contract.amortizationShape && (
              <div className="flex justify-between"><span className="text-muted-foreground">Amortization</span><span className="capitalize">{contract.amortizationShape}</span></div>
            )}
            {contract.notes && (
              <div>
                <p className="text-muted-foreground">Notes</p>
                <p className="mt-1">{contract.notes}</p>
              </div>
            )}

            {/*
             * Charles 2026-04-25 (audit re-pass — facility BLOCKER):
             * surface the rebate-term + tier structure so the
             * approver sees what they're actually agreeing to. The
             * vendor's terms blob is JSON; we render a readable
             * outline. Empty / malformed payloads are skipped.
             */}
            <PendingTermsSection terms={contract.terms} />
          </TabsContent>

          <TabsContent
            value="action"
            className="min-h-0 flex-1 space-y-4 overflow-y-auto"
          >
            <Textarea
              placeholder="Review notes (required for reject / revision)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
            <div className="flex flex-wrap gap-2">
              <Button onClick={onApprove} disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="animate-spin" />}
                Approve
              </Button>
              <Button
                variant="outline"
                onClick={() => onRequestRevision(notes)}
                disabled={isSubmitting || !notes.trim()}
              >
                Request Revision
              </Button>
              <Button
                variant="destructive"
                onClick={() => onReject(notes)}
                disabled={isSubmitting || !notes.trim()}
              >
                Reject
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
