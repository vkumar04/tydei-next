"use client"

/**
 * Print-friendly proposal analysis report (bug-bash C1, Charles 2026-06-11:
 * "Need a way to export/save the report").
 *
 * Rendered `hidden print:block` alongside the interactive upload tab; the
 * "Export report" button calls `window.print()` and the browser's
 * print-to-PDF does the saving — no new deps. A scoped `@media print` rule
 * in `app/globals.css` (keyed on `.proposal-report-print`) hides the rest of
 * the app shell so the printout is ONLY this report.
 *
 * Deliberately styled with literal light-mode colors (white background,
 * near-black text) instead of theme tokens, so a dark-mode session still
 * prints a clean light document.
 */

import { formatCurrency, formatDate } from "@/lib/formatting"
import type { ProposalVerdict } from "@/lib/prospective-analysis/proposal-verdict"
import type { PricingFileAnalysis } from "@/lib/prospective-analysis/pricing-file-analysis"
import type { VendorLookbackComparison } from "@/lib/actions/prospective-analysis"
import type { PDFContractAnalysisResult } from "@/lib/contracts/clause-risk-analyzer"
import type { ScoredProposal } from "./types"

const VERDICT_LABELS: Record<ProposalVerdict["verdict"], string> = {
  good_deal: "Good deal",
  negotiate: "Negotiate",
  decline: "Decline",
}

const TONE_MARKERS: Record<"positive" | "warning" | "negative", string> = {
  positive: "+",
  warning: "!",
  negative: "−",
}

function humanizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/^./, (c) => c.toUpperCase())
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mb-1 mt-5 border-b border-neutral-300 pb-1 text-sm font-bold uppercase tracking-wide text-neutral-700">
      {children}
    </h2>
  )
}

function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 text-sm">
      <span className="text-neutral-500">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  )
}

export interface ProposalReportPrintProps {
  vendorName: string | null
  contractFileName: string | null
  pricingFileName: string | null
  verdict: ProposalVerdict | null
  scored: ScoredProposal | null
  lookback: VendorLookbackComparison | null
  pricing: PricingFileAnalysis | null
  legal: PDFContractAnalysisResult | null
}

export function ProposalReportPrint({
  vendorName,
  contractFileName,
  pricingFileName,
  verdict,
  scored,
  lookback,
  pricing,
  legal,
}: ProposalReportPrintProps) {
  const predicted = lookback?.predicted ?? null

  return (
    <div className="proposal-report-print hidden bg-white p-8 text-black print:block">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <h1 className="text-xl font-bold">Vendor proposal analysis</h1>
      <div className="mt-1 space-y-0.5 text-sm text-neutral-600">
        {vendorName ? <p>Vendor: {vendorName}</p> : null}
        {contractFileName ? <p>Contract file: {contractFileName}</p> : null}
        {pricingFileName ? <p>Price file: {pricingFileName}</p> : null}
        <p>
          Analyzed:{" "}
          {formatDate(scored?.createdAt ?? new Date().toISOString())}
        </p>
      </div>

      {/* ── Verdict ─────────────────────────────────────────────────── */}
      {verdict ? (
        <>
          <SectionTitle>Verdict</SectionTitle>
          <p className="text-lg font-bold">
            {VERDICT_LABELS[verdict.verdict]}{" "}
            <span className="text-sm font-normal text-neutral-600">
              ({verdict.confidence} confidence)
            </span>
          </p>
          <ul className="mt-1 space-y-0.5 text-sm">
            {verdict.reasons.map((r, i) => (
              <li key={i}>
                <span className="mr-1.5 inline-block w-3 text-center font-mono font-bold">
                  {TONE_MARKERS[r.tone]}
                </span>
                {r.text}
              </li>
            ))}
          </ul>
          {verdict.missingInputs.length > 0 ? (
            <p className="mt-1 text-xs text-neutral-500">
              Verdict would firm up with: {verdict.missingInputs.join(", ")}.
            </p>
          ) : null}
        </>
      ) : null}

      {/* ── Term score ──────────────────────────────────────────────── */}
      {scored ? (
        <>
          <SectionTitle>Term score</SectionTitle>
          <div className="max-w-sm space-y-0.5">
            <FactRow
              label="Overall score"
              value={`${scored.result.scores.overall.toFixed(1)} / 10 (${scored.result.recommendation.verdict})`}
            />
            <FactRow
              label="Cost savings"
              value={`${scored.result.scores.costSavings.toFixed(1)} / 10`}
            />
            <FactRow
              label="Price competitiveness"
              value={`${scored.result.scores.priceCompetitiveness.toFixed(1)} / 10`}
            />
            <FactRow
              label="Rebate attainability"
              value={`${scored.result.scores.rebateAttainability.toFixed(1)} / 10`}
            />
            <FactRow
              label="Lock-in risk"
              value={`${scored.result.scores.lockInRisk.toFixed(1)} / 10`}
            />
          </div>
        </>
      ) : null}

      {/* ── 12-month lookback (projection) ──────────────────────────── */}
      {lookback && lookback.vendorId !== null ? (
        <>
          <SectionTitle>12-month lookback (projection)</SectionTitle>
          <div className="max-w-sm space-y-0.5">
            <FactRow
              label="Spend (last 12 mo)"
              value={formatCurrency(lookback.trailing12moSpend)}
            />
            <FactRow
              label="Projected tier"
              value={
                predicted
                  ? `Tier ${predicted.tierAchieved} · ${predicted.rebatePercent.toFixed(1)}%`
                  : "—"
              }
            />
            <FactRow
              label="Projected rebate / yr"
              value={
                predicted ? formatCurrency(predicted.annualRebate) : "—"
              }
            />
          </div>
          {lookback.existingContracts.length > 0 ? (
            <table className="mt-2 w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-300 text-left text-xs text-neutral-500">
                  <th className="py-1 font-medium">Existing contract</th>
                  <th className="py-1 text-right font-medium">
                    Lifetime earned
                  </th>
                  <th className="py-1 text-right font-medium">
                    Effective rate
                  </th>
                  <th className="py-1 text-right font-medium">Top tier</th>
                  <th className="py-1 text-right font-medium">Expires</th>
                </tr>
              </thead>
              <tbody>
                {lookback.existingContracts.map((c) => (
                  <tr key={c.id} className="border-b border-neutral-200">
                    <td className="py-1">
                      {c.name}{" "}
                      <span className="text-xs text-neutral-500">
                        ({c.status})
                      </span>
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {formatCurrency(c.lifetimeEarned)}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {c.effectiveRatePct !== null
                        ? `${c.effectiveRatePct.toFixed(2)}%`
                        : "—"}
                    </td>
                    <td className="py-1 text-right tabular-nums">
                      {c.topTierRatePct !== null
                        ? `${c.topTierRatePct.toFixed(1)}%`
                        : "—"}
                    </td>
                    <td className="py-1 text-right">
                      {c.expirationDate ? formatDate(c.expirationDate) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="mt-1 text-xs text-neutral-500">
              No existing contracts with this vendor — net-new relationship.
            </p>
          )}
        </>
      ) : null}

      {/* ── Pricing file vs current COG cost ────────────────────────── */}
      {pricing ? (
        <>
          <SectionTitle>Pricing vs current cost</SectionTitle>
          <div className="max-w-sm space-y-0.5">
            <FactRow
              label="Lines matched to COG"
              value={`${pricing.summary.itemsWithCOGMatch} / ${pricing.summary.totalItems}`}
            />
            <FactRow
              label="Avg variance"
              value={`${pricing.summary.avgVariancePercent.toFixed(1)}%`}
            />
            <FactRow
              label="Proposed annual spend"
              value={formatCurrency(pricing.summary.totalProposedAnnualSpend)}
            />
            <FactRow
              label="Current annual spend"
              value={formatCurrency(pricing.summary.totalCurrentAnnualSpend)}
            />
            <FactRow
              label="Potential savings"
              value={formatCurrency(pricing.summary.potentialSavings)}
            />
            <FactRow
              label="Lines below / above current"
              value={`${pricing.summary.itemsBelowCOG} / ${pricing.summary.itemsAboveCOG}`}
            />
          </div>
        </>
      ) : null}

      {/* ── Legal language scan ─────────────────────────────────────── */}
      {legal ? (
        <>
          <SectionTitle>Legal language scan</SectionTitle>
          <div className="max-w-sm space-y-0.5">
            <FactRow
              label="Overall risk"
              value={`${legal.overallRiskScore} / 100 (${humanizeToken(legal.overallRiskLevel)})`}
            />
          </div>
          {legal.criticalFlags.length > 0 ? (
            <ul className="mt-1 space-y-1 text-sm">
              {legal.criticalFlags.map((f, i) => (
                <li key={i}>
                  <span className="font-bold">
                    [{f.riskLevel}] {humanizeToken(f.category)}:
                  </span>{" "}
                  {f.message}
                  {f.regulatoryImplication ? (
                    <span className="text-xs text-neutral-500">
                      {" "}
                      ({f.regulatoryImplication})
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-sm">No critical legal flags.</p>
          )}
          {legal.missingClauses.length > 0 ? (
            <p className="mt-1 text-xs text-neutral-500">
              Missing clauses to request:{" "}
              {legal.missingClauses
                .map((m) => humanizeToken(m.category))
                .join(", ")}
              .
            </p>
          ) : null}
        </>
      ) : null}

      <p className="mt-6 border-t border-neutral-300 pt-2 text-[10px] text-neutral-400">
        Generated by tydei — projections are estimates from trailing-12-month
        COG spend, not earned rebate figures.
      </p>
    </div>
  )
}
