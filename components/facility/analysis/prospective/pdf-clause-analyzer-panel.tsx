"use client"

/**
 * PDF clause analyzer panel (spec §subsystem-7).
 *
 * Renders a ClauseAnalysis from `analyzeUploadedPDF`:
 *   - Overall risk score + headline summary
 *   - Missing-high-risk alerts
 *   - Per-category findings table (category · risk · favorability · quote)
 *   - Export-to-markdown button
 */

import { useMemo } from "react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { AlertTriangle, Download, ShieldAlert } from "lucide-react"
import type { ClauseAnalysis } from "@/lib/actions/prospective-analysis"
import type { ClauseFinding } from "@/lib/prospective-analysis/pdf-clause-analyzer"

function categoryLabel(cat: ClauseFinding["category"]): string {
  return cat
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
}

function riskClass(level: ClauseFinding["riskLevel"]): string {
  if (level === "high")
    return "bg-red-100 text-red-800 border-red-300 dark:bg-red-950/40 dark:text-red-200"
  if (level === "medium")
    return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/40 dark:text-amber-200"
  return "bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/40 dark:text-emerald-200"
}

function favorClass(fav: ClauseFinding["favorability"]): string {
  if (fav === "vendor")
    return "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-200"
  if (fav === "facility")
    return "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-200"
  return "bg-muted text-muted-foreground"
}

function toMarkdown(analysis: ClauseAnalysis, fileName?: string): string {
  const lines: string[] = []
  lines.push(`# Contract clause analysis${fileName ? ` — ${fileName}` : ""}`)
  lines.push("")
  lines.push(`**Overall risk score:** ${analysis.overallRiskScore.toFixed(2)} / 10`)
  lines.push("")
  lines.push(`_${analysis.summary}_`)
  lines.push("")
  if (analysis.missingHighRiskCategories.length > 0) {
    lines.push("## Missing required clauses")
    for (const cat of analysis.missingHighRiskCategories) {
      lines.push(`- ${categoryLabel(cat)}`)
    }
    lines.push("")
  }
  lines.push("## Findings")
  lines.push("")
  lines.push("| Clause | Found | Risk | Favorability | Quote | Action |")
  lines.push("|---|---|---|---|---|---|")
  for (const f of analysis.findings) {
    const quote = f.quote ? f.quote.replace(/\|/g, "\\|").slice(0, 200) : "—"
    const action = f.recommendedAction
      ? f.recommendedAction.replace(/\|/g, "\\|")
      : "—"
    lines.push(
      `| ${categoryLabel(f.category)} | ${f.found ? "Yes" : "No"} | ${f.riskLevel} | ${f.favorability} | ${quote} | ${action} |`,
    )
  }
  return lines.join("\n")
}

export interface PdfClauseAnalyzerPanelProps {
  analysis: ClauseAnalysis
  fileName?: string
}

export function PdfClauseAnalyzerPanel({
  analysis,
  fileName,
}: PdfClauseAnalyzerPanelProps) {
  const markdown = useMemo(
    () => toMarkdown(analysis, fileName),
    [analysis, fileName],
  )

  const handleExport = () => {
    const blob = new Blob([markdown], { type: "text/markdown" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    const base = fileName
      ? fileName.replace(/\.[^.]+$/, "")
      : "clause-analysis"
    a.download = `${base}-clauses.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldAlert className="h-4 w-4" />
              Clause analysis
            </CardTitle>
            <CardDescription>{analysis.summary}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Badge
              variant="outline"
              className={
                analysis.overallRiskScore >= 5
                  ? "bg-red-100 text-red-800 border-red-300"
                  : analysis.overallRiskScore >= 2
                    ? "bg-amber-100 text-amber-800 border-amber-300"
                    : "bg-emerald-100 text-emerald-800 border-emerald-300"
              }
            >
              Risk {analysis.overallRiskScore.toFixed(1)} / 10
            </Badge>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              aria-label="Export clause analysis as markdown"
            >
              <Download className="h-3.5 w-3.5 mr-1.5" />
              Export .md
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {analysis.missingHighRiskCategories.length > 0 ? (
          <div className="rounded-md border border-amber-300 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
            <p className="flex items-center gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4" />
              Missing required clauses ({analysis.missingHighRiskCategories.length})
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {analysis.missingHighRiskCategories.map((cat) => (
                <Badge
                  key={cat}
                  variant="outline"
                  className="bg-white text-amber-800 border-amber-300"
                >
                  {categoryLabel(cat)}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[180px]">Category</TableHead>
                <TableHead className="w-[90px]">Risk</TableHead>
                <TableHead className="w-[120px]">Favorability</TableHead>
                <TableHead>Quote</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {analysis.findings.map((f) => (
                <TableRow key={f.category}>
                  <TableCell className="font-medium">
                    {categoryLabel(f.category)}
                    {!f.found ? (
                      <span className="text-xs text-muted-foreground ml-1">
                        (not found)
                      </span>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className={riskClass(f.riskLevel)}>
                      {f.riskLevel}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={favorClass(f.favorability)}
                    >
                      {f.favorability}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {f.quote ? (
                      <span className="line-clamp-2" title={f.quote}>
                        &ldquo;{f.quote}&rdquo;
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  )
}
