"use client"

/**
 * Canonical PDF clause analyzer panel.
 *
 * Renders a `PDFContractAnalysisResult` from the canonical
 * `analyzePDFContract` engine (24 categories, 0-100 score, side-aware,
 * per-variant required clauses, regulatory cross-checks).
 *
 * Sister to {@link PdfClauseAnalyzerPanel}, which still renders the
 * legacy 0-10 `ClauseAnalysis` shape from
 * `lib/prospective-analysis/pdf-clause-analyzer.ts`. Both can coexist
 * — they're complementary.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, ShieldAlert, ShieldCheck, Sparkles } from "lucide-react"
import type {
  PDFContractAnalysisResult,
  RiskLevel,
  ClauseCategory,
} from "@/lib/contracts/clause-risk-analyzer"

function categoryLabel(cat: ClauseCategory): string {
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ")
}

function riskClass(level: RiskLevel): string {
  if (level === "CRITICAL")
    return "bg-red-200 text-red-900 border-red-400 dark:bg-red-950/60 dark:text-red-100 dark:border-red-700"
  if (level === "HIGH")
    return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200"
  if (level === "MEDIUM")
    return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200"
  return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200"
}

function overallRiskBadgeClass(level: RiskLevel): string {
  if (level === "CRITICAL")
    return "bg-red-200 text-red-900 border-red-400"
  if (level === "HIGH") return "bg-red-100 text-red-800 border-red-300"
  if (level === "MEDIUM") return "bg-amber-100 text-amber-800 border-amber-300"
  return "bg-emerald-100 text-emerald-800 border-emerald-300"
}

export interface CanonicalClauseAnalyzerPanelProps {
  result: PDFContractAnalysisResult
  /** Set when the LLM extractor found no clauses — surface a helpful
   *  empty-state instead of an alarming "100% risk" looking panel. */
  extractedClauseCount: number
  truncated: boolean
}

export function CanonicalClauseAnalyzerPanel({
  result,
  extractedClauseCount,
  truncated,
}: CanonicalClauseAnalyzerPanelProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              Canonical clause analysis
            </CardTitle>
            <CardDescription>{result.summary}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge
              variant="outline"
              className={overallRiskBadgeClass(result.overallRiskLevel)}
            >
              {result.overallRiskLevel} {result.overallRiskScore}/100
            </Badge>
            <span className="text-[10px] text-muted-foreground">
              {result.side === "FACILITY" ? "Facility view" : "Vendor view"} ·{" "}
              {result.contractVariant.replace(/_/g, " ")}
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {extractedClauseCount === 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
            <p className="flex items-center gap-2 font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              No clauses extracted from PDF text
            </p>
            <p className="mt-1 text-xs text-amber-800 dark:text-amber-300">
              The LLM did not identify any classifiable clauses in the document.
              The PDF may be a scanned image (no text layer) or a non-contract
              file. Missing-clause flags below are based on the contract
              variant&apos;s required list.
            </p>
          </div>
        ) : null}

        {truncated ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 p-2 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
            Document text exceeded 50KB — analysis used the first 50KB only.
          </div>
        ) : null}

        {result.criticalFlags.length > 0 ? (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
            <p className="flex items-center gap-2 text-sm font-medium text-red-900 dark:text-red-200">
              <AlertTriangle className="h-4 w-4" />
              Critical flags ({result.criticalFlags.length})
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-red-900 dark:text-red-100">
              {result.criticalFlags.map((flag) => (
                <li key={`${flag.category}-${flag.message}`}>
                  <span className="font-medium">
                    {categoryLabel(flag.category)}:
                  </span>{" "}
                  {flag.message}
                  {flag.regulatoryImplication ? (
                    <span className="block text-xs italic text-red-800/80 dark:text-red-200/80">
                      {flag.regulatoryImplication}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.missingClauses.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Missing required clauses ({result.missingClauses.length})
            </p>
            <ul className="mt-2 space-y-2 text-sm text-amber-900 dark:text-amber-100">
              {result.missingClauses.map((m) => (
                <li key={m.category}>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="outline"
                      className={riskClass(m.riskLevel)}
                    >
                      {m.riskLevel}
                    </Badge>
                    <span className="font-medium">
                      {categoryLabel(m.category)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs">{m.reason}</p>
                  <details className="mt-1 text-xs">
                    <summary className="cursor-pointer text-amber-800 dark:text-amber-300">
                      Recommended language
                    </summary>
                    <p className="mt-1 whitespace-pre-line rounded bg-white/60 p-2 text-[11px] leading-relaxed text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
                      {m.recommendedLanguage}
                    </p>
                  </details>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {result.negotiationPriorities.length > 0 ? (
          <div className="rounded-md border bg-muted/30 p-3">
            <p className="flex items-center gap-2 text-sm font-medium">
              <Sparkles className="h-4 w-4" />
              Top negotiation priorities
            </p>
            <ol className="mt-2 list-decimal space-y-0.5 pl-5 text-sm">
              {result.negotiationPriorities.map((cat) => (
                <li key={cat}>{categoryLabel(cat)}</li>
              ))}
            </ol>
          </div>
        ) : null}

        {result.favorableTerms.length > 0 ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-900 dark:text-emerald-200">
              <ShieldCheck className="h-4 w-4" />
              Favorable terms ({result.favorableTerms.length})
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {result.favorableTerms.map((cat) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className="bg-emerald-50 text-emerald-900 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-100 dark:border-emerald-800"
                >
                  {categoryLabel(cat)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {result.clauseAssessments.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Clause</TableHead>
                  <TableHead className="w-[110px]">Risk</TableHead>
                  <TableHead className="w-[110px]">Favorability</TableHead>
                  <TableHead>Top concern</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.clauseAssessments.map((a) => (
                  <TableRow key={a.category}>
                    <TableCell className="font-medium">
                      {categoryLabel(a.category)}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className={riskClass(a.riskLevel)}>
                        {a.riskLevel}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          a.isFavorable
                            ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                            : "bg-muted text-muted-foreground"
                        }
                      >
                        {a.isFavorable ? "favorable" : "neutral"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {a.concerns[0] ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
