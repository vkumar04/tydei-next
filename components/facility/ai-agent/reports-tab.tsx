"use client"

/**
 * Reports tab for `/dashboard/ai-agent`.
 *
 * Form collects a contract + date range + report-type hint + free-form
 * prompt, then POSTs to `/api/ai/generate-report` (wraps the
 * `generateReportFromPrompt` server action which returns a structured
 * `GeneratedReport` — title, description, columns, rows, optional notes).
 *
 * Renders the result as a shadcn/ui Table + CSV download. The server
 * action already computes the canonical filename.
 */

import { useMemo, useState } from "react"
import { useMutation } from "@tanstack/react-query"
import {
  Sparkles,
  Loader2,
  ClipboardList,
  Download,
  FileText,
  TrendingUp,
  DollarSign,
  Shield,
  PieChart,
  Zap,
} from "lucide-react"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { GeneratedReport } from "@/lib/actions/ai/report-generator"

interface ContractOption {
  id: string
  name: string
}

interface ReportsTabProps {
  contracts: ContractOption[]
}

type ReportTypeHint =
  | "auto"
  | "contract_performance"
  | "surgeon_performance"
  | "rebate_analysis"
  | "invoice_discrepancy"
  | "custom"

interface ReportTypeOption {
  id: ReportTypeHint
  label: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  keyword: string
}

// Each report-type hint maps to a keyword that flips the
// deterministic classifier in `lib/ai/report-classifier.ts`. When the
// user picks a hint, we prepend the keyword to their prompt so the
// server action routes to the right template.
const REPORT_TYPES: readonly ReportTypeOption[] = [
  {
    id: "auto",
    label: "Auto-detect",
    description: "Let the classifier pick based on the prompt",
    icon: Sparkles,
    keyword: "",
  },
  {
    id: "contract_performance",
    label: "Contract Performance",
    description: "Vendor, compliance %, rebate earned",
    icon: FileText,
    keyword: "contract",
  },
  {
    id: "surgeon_performance",
    label: "Surgeon Performance",
    description: "Cases, avg cost, efficiency",
    icon: TrendingUp,
    keyword: "surgeon",
  },
  {
    id: "rebate_analysis",
    label: "Rebate Analysis",
    description: "Current tier, spend to next tier",
    icon: DollarSign,
    keyword: "rebate",
  },
  {
    id: "invoice_discrepancy",
    label: "Invoice Discrepancy",
    description: "Invoiced vs contract, variance",
    icon: Shield,
    keyword: "invoice discrepancy",
  },
  {
    id: "custom",
    label: "Custom",
    description: "Category, metric, value",
    icon: PieChart,
    keyword: "custom",
  },
] as const

function escapeCSV(value: string | number): string {
  const s = String(value)
  return `"${s.replace(/"/g, '""')}"`
}

function toCSV(report: GeneratedReport): string {
  const header = report.columns.map(escapeCSV).join(",")
  const rows = report.data.map((row) =>
    report.columns
      .map((col) => {
        const cell = row[col]
        return escapeCSV(cell ?? "")
      })
      .join(","),
  )
  return [header, ...rows].join("\n")
}

function downloadCSV(report: GeneratedReport): void {
  const csv = toCSV(report)
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = report.filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export function ReportsTab({ contracts }: ReportsTabProps) {
  const [contractId, setContractId] = useState<string>("__all__")
  const [dateFrom, setDateFrom] = useState<string>("")
  const [dateTo, setDateTo] = useState<string>("")
  const [typeHint, setTypeHint] = useState<ReportTypeHint>("auto")
  const [prompt, setPrompt] = useState("")
  const [report, setReport] = useState<GeneratedReport | null>(null)

  const contractsById = useMemo(() => {
    const map = new Map<string, ContractOption>()
    for (const c of contracts) map.set(c.id, c)
    return map
  }, [contracts])

  const generateMutation = useMutation({
    mutationFn: async (): Promise<GeneratedReport> => {
      // Build an enriched prompt — the server action takes a single
      // string, so we prepend the type hint's keyword + structured
      // metadata so the classifier routes correctly and the model has
      // the right context.
      const parts: string[] = []
      const typeOpt = REPORT_TYPES.find((r) => r.id === typeHint)
      if (typeOpt && typeOpt.keyword.length > 0) {
        parts.push(`Report type hint: ${typeOpt.keyword}.`)
      }
      if (contractId && contractId !== "__all__") {
        const name = contractsById.get(contractId)?.name
        if (name) parts.push(`Focus on contract: ${name}.`)
      }
      if (dateFrom || dateTo) {
        parts.push(
          `Date range: ${dateFrom || "beginning"} to ${dateTo || "today"}.`,
        )
      }
      parts.push(prompt.trim().length > 0 ? prompt.trim() : "Generate a useful default report.")

      const fullPrompt = parts.join(" ")

      const res = await fetch("/api/ai/generate-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: fullPrompt }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `Report generation failed (${res.status})`)
      }
      const data = (await res.json()) as { report: GeneratedReport }
      return data.report
    },
    onSuccess: (r) => setReport(r),
  })

  const generating = generateMutation.isPending
  const canGenerate =
    !generating && (prompt.trim().length > 0 || typeHint !== "auto")

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      {/* Config panel */}
      <div className="lg:col-span-2 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <ClipboardList className="h-5 w-5 text-primary" />
              Report Configuration
            </CardTitle>
            <CardDescription>
              Pick a type + contract + date range, or describe a custom report.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="report-type">Report Type</Label>
              <Select
                value={typeHint}
                onValueChange={(v) => setTypeHint(v as ReportTypeHint)}
              >
                <SelectTrigger id="report-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REPORT_TYPES.map((rt) => (
                    <SelectItem key={rt.id} value={rt.id}>
                      <div className="flex items-center gap-2">
                        <rt.icon className="h-4 w-4" />
                        {rt.label}
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report-contract">Contract (optional)</Label>
              <Select value={contractId} onValueChange={setContractId}>
                <SelectTrigger id="report-contract">
                  <SelectValue placeholder="All contracts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__all__">All contracts</SelectItem>
                  {contracts.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-2">
                <Label htmlFor="report-from">From</Label>
                <Input
                  id="report-from"
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="report-to">To</Label>
                <Input
                  id="report-to"
                  type="date"
                  value={dateTo}
                  onChange={(e) => setDateTo(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="report-prompt">Additional instructions</Label>
              <Textarea
                id="report-prompt"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g. show my top 10 rebate opportunities this quarter"
                rows={5}
              />
            </div>

            <Button
              className="w-full"
              onClick={() => generateMutation.mutate()}
              disabled={!canGenerate}
            >
              {generating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating Report…
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  Generate Report
                </>
              )}
            </Button>

            {generateMutation.isError && (
              <div className="text-sm text-destructive">
                {generateMutation.error instanceof Error
                  ? generateMutation.error.message
                  : "Report generation failed."}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Quick Reports</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-2">
              {REPORT_TYPES.filter((rt) => rt.id !== "auto").map((rt) => (
                <Button
                  key={rt.id}
                  variant="outline"
                  size="sm"
                  className="h-auto p-3 flex flex-col items-start gap-1 text-left"
                  onClick={() => {
                    setTypeHint(rt.id)
                    setPrompt(rt.description)
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <rt.icon className="h-3.5 w-3.5 text-primary" />
                    <span className="text-xs font-medium">{rt.label}</span>
                  </div>
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="h-auto p-3 flex flex-col items-start gap-1 text-left col-span-2"
                onClick={() => {
                  setTypeHint("rebate_analysis")
                  setPrompt("Show me my top 10 rebate opportunities this quarter")
                }}
              >
                <div className="flex items-center gap-1.5">
                  <Zap className="h-3.5 w-3.5 text-primary" />
                  <span className="text-xs font-medium">
                    Top rebate opportunities
                  </span>
                </div>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Preview panel */}
      <div className="lg:col-span-3">
        <Card className="h-full">
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Report Preview</CardTitle>
              {report && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadCSV(report)}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    Download CSV
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {generating ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Loader2 className="h-12 w-12 animate-spin text-primary mb-4" />
                <h3 className="text-lg font-medium mb-2">
                  Generating Your Report
                </h3>
                <p className="text-sm text-muted-foreground max-w-md">
                  Claude Opus 4.6 is analyzing your prompt, routing to the
                  right template, and assembling structured rows.
                </p>
              </div>
            ) : report ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b pb-4">
                  <div>
                    <h3 className="text-lg font-semibold m-0">
                      {report.title}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Generated{" "}
                      {new Date(report.generatedAt).toLocaleString("en-US", {
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                  <Badge>{report.reportType.replace(/_/g, " ")}</Badge>
                </div>

                <p className="text-sm text-muted-foreground">
                  {report.description}
                </p>

                {report.data.length === 0 ? (
                  <div className="text-sm text-muted-foreground text-center py-6 border rounded-lg">
                    No rows returned.
                  </div>
                ) : (
                  <div className="overflow-x-auto border rounded-lg">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          {report.columns.map((col) => (
                            <TableHead key={col}>{col}</TableHead>
                          ))}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {report.data.map((row, i) => (
                          <TableRow key={i}>
                            {report.columns.map((col) => (
                              <TableCell key={col}>
                                {row[col] === undefined || row[col] === null
                                  ? "—"
                                  : String(row[col])}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}

                {report.notes && (
                  <div className="rounded-lg bg-muted p-3 text-xs text-muted-foreground">
                    <strong className="text-foreground">Notes: </strong>
                    {report.notes}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-center text-muted-foreground">
                <ClipboardList className="h-12 w-12 mb-4 opacity-50" />
                <h3 className="text-lg font-medium mb-2">
                  No Report Generated Yet
                </h3>
                <p className="text-sm max-w-md">
                  Pick a report type and click Generate to let Claude Opus 4.6
                  produce a structured table from your contract data.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
