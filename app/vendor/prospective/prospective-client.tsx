"use client"

import { useState, useMemo } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
// Table imports removed - using card-based proposal layout
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  Cell,
} from "recharts"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  FileText,
  DollarSign,
  CheckCircle2,
  Target,
  TrendingUp,
  ArrowUpRight,
  Gauge,
  Plus,
  BarChart3,
  Eye,
  Pencil,
  Trash2,
  MoreHorizontal,
  Trophy,
  Percent,
  AlertTriangle,
  Lightbulb,
  Package,
  Calendar,
  Building2,
  Scale,
  Upload,
  Download,
} from "lucide-react"
import { toast } from "sonner"
import { useVendorProposals } from "@/hooks/use-prospective"
import { formatCurrency } from "@/lib/formatting"
import { chartTooltipStyle } from "@/lib/chart-config"
import type { DealScore, VendorProposal } from "@/lib/actions/prospective"

// ─── Status badge configuration ────────────────────────────────

const STATUS_CONFIG: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Draft", variant: "outline" },
  submitted: { label: "Submitted", variant: "secondary" },
  under_review: { label: "Under Review", variant: "default" },
  accepted: { label: "Accepted", variant: "default" },
  rejected: { label: "Rejected", variant: "destructive" },
}

function StatusBadge({ status }: { status: string }) {
  const config = STATUS_CONFIG[status] ?? { label: status, variant: "outline" as const }
  return <Badge variant={config.variant}>{config.label}</Badge>
}

// ─── Recommendation badge configuration ────────────────────────

const RECOMMENDATION_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  strong_accept: { label: "Strong Accept", className: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  accept: { label: "Accept", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
  negotiate: { label: "Negotiate", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
  reject: { label: "Decline", className: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
}

function RecommendationBadge({ recommendation }: { recommendation: string }) {
  const config = RECOMMENDATION_CONFIG[recommendation] ?? RECOMMENDATION_CONFIG.negotiate!
  return (
    <span className={`inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold ${config.className}`}>
      {config.label}
    </span>
  )
}

// ─── Score color helper ────────────────────────────────────────

function scoreColor(score: number): string {
  if (score >= 80) return "text-green-600 dark:text-green-400"
  if (score >= 65) return "text-emerald-600 dark:text-emerald-400"
  if (score >= 40) return "text-amber-600 dark:text-amber-400"
  return "text-red-600 dark:text-red-400"
}

// ─── Deal Scorer mock data (deterministic per-proposal scoring) ─

function generateDealScore(seed: string): DealScore {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  const r = (min: number, max: number) => { h = (h * 16807 + 12345) & 0x7fffffff; return min + (h % (max - min + 1)) }
  const dims = { financialValue: r(45, 95), rebateEfficiency: r(30, 90), pricingCompetitiveness: r(40, 95), marketShareAlignment: r(35, 85), complianceLikelihood: r(50, 95) }
  const overall = Math.round(dims.financialValue * 0.3 + dims.rebateEfficiency * 0.15 + dims.pricingCompetitiveness * 0.25 + dims.marketShareAlignment * 0.15 + dims.complianceLikelihood * 0.15)
  const recommendation: DealScore["recommendation"] = overall >= 80 ? "strong_accept" : overall >= 65 ? "accept" : overall < 40 ? "reject" : "negotiate"
  return { overall, ...dims, recommendation }
}

// ─── Deal Scorer Section ───────────────────────────────────────

function DealScorerSection({ proposals }: { proposals: VendorProposal[] }) {
  const [selectedProposalId, setSelectedProposalId] = useState<string>("")

  const score = useMemo(() => {
    if (!selectedProposalId) return null
    const proposal = proposals.find((p) => p.id === selectedProposalId)
    if (!proposal) return null
    return proposal.dealScore ?? generateDealScore(proposal.id)
  }, [selectedProposalId, proposals])

  const radarData = useMemo(() => {
    if (!score) return []
    return [
      { dimension: "Savings Potential", value: score.financialValue, fullMark: 100 },
      { dimension: "Price Competitiveness", value: score.pricingCompetitiveness, fullMark: 100 },
      { dimension: "Rebate Efficiency", value: score.rebateEfficiency, fullMark: 100 },
      { dimension: "Compliance", value: score.complianceLikelihood, fullMark: 100 },
      { dimension: "Market Share", value: score.marketShareAlignment, fullMark: 100 },
    ]
  }, [score])

  if (proposals.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Gauge className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
          <p className="font-medium text-muted-foreground">No proposals to score</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a proposal first to see its deal score analysis
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Proposal selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Select Proposal</CardTitle>
          <CardDescription>Choose a proposal to analyze its deal score</CardDescription>
        </CardHeader>
        <CardContent>
          <Select value={selectedProposalId} onValueChange={setSelectedProposalId}>
            <SelectTrigger className="w-full max-w-md">
              <SelectValue placeholder="Select a proposal..." />
            </SelectTrigger>
            <SelectContent>
              {proposals.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.itemCount} items - {formatCurrency(p.totalProposedCost)} ({p.facilityIds.length} facilities)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {/* Score results */}
      {score && (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* Radar Chart */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Deal Score Analysis</CardTitle>
                <div className={`text-2xl font-bold ${scoreColor(score.overall)}`}>
                  {score.overall}/100
                </div>
              </div>
              <CardDescription>
                Multi-dimensional scoring across 5 key deal factors
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart data={radarData}>
                    <PolarGrid className="stroke-muted" />
                    <PolarAngleAxis
                      dataKey="dimension"
                      tick={{ fontSize: 10 }}
                      className="fill-muted-foreground"
                    />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 10 }} />
                    <Radar
                      name="Score"
                      dataKey="value"
                      stroke="var(--primary)"
                      fill="var(--primary)"
                      fillOpacity={0.2}
                    />
                    <RechartsTooltip contentStyle={chartTooltipStyle} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Score Breakdown + Recommendation */}
          <div className="space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Recommendation</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-3">
                  <RecommendationBadge recommendation={score.recommendation} />
                  <span className="text-sm text-muted-foreground">
                    Based on weighted analysis of all dimensions
                  </span>
                </div>
                <p className="text-sm text-muted-foreground">
                  {{ strong_accept: "Excellent metrics across all dimensions. Highly recommended for immediate acceptance.",
                     accept: "Favorable terms overall. Consider moving forward with standard review.",
                     negotiate: "Some dimensions could be improved. Consider adjusting pricing or terms.",
                     reject: "Significant revisions needed before this can be considered competitive.",
                  }[score.recommendation]}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Dimension Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {[
                    { label: "Savings Potential", value: score.financialValue, weight: "30%" },
                    { label: "Price Competitiveness", value: score.pricingCompetitiveness, weight: "25%" },
                    { label: "Rebate Efficiency", value: score.rebateEfficiency, weight: "15%" },
                    { label: "Compliance", value: score.complianceLikelihood, weight: "15%" },
                    { label: "Market Share", value: score.marketShareAlignment, weight: "15%" },
                  ].map((dim) => (
                    <div key={dim.label} className="space-y-1">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-muted-foreground">{dim.label}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">({dim.weight})</span>
                          <span className={`font-medium ${scoreColor(dim.value)}`}>
                            {dim.value}
                          </span>
                        </div>
                      </div>
                      <div className="h-2 rounded-full bg-muted">
                        <div
                          className={`h-full rounded-full transition-all ${
                            dim.value >= 80
                              ? "bg-green-500"
                              : dim.value >= 65
                              ? "bg-emerald-500"
                              : dim.value >= 40
                              ? "bg-amber-500"
                              : "bg-red-500"
                          }`}
                          style={{ width: `${dim.value}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Analytics Section ─────────────────────────────────────────

const STATUS_BAR_COLORS: Record<string, string> = {
  draft: "#94a3b8",
  submitted: "#3b82f6",
  accepted: "#22c55e",
  rejected: "#ef4444",
  under_review: "#f59e0b",
}

function AnalyticsSection({ proposals, isLoading }: { proposals: VendorProposal[]; isLoading: boolean }) {
  const metrics = useMemo(() => {
    if (!proposals) return { total: 0, avgScore: 0, pipeline: 0, winRate: 0 }

    const scored = proposals.filter((p) => p.dealScore)
    const avgScore = scored.length > 0
      ? Math.round(scored.reduce((s, p) => s + (p.dealScore?.overall ?? 0), 0) / scored.length)
      : 0

    const pipeline = proposals.reduce((s, p) => s + p.totalProposedCost, 0)
    const accepted = proposals.filter((p) => p.status === "accepted").length
    const decidedCount = proposals.filter(
      (p) => p.status === "accepted" || p.status === "rejected"
    ).length
    const winRate = decidedCount > 0 ? Math.round((accepted / decidedCount) * 100) : 0

    return { total: proposals.length, avgScore, pipeline, winRate }
  }, [proposals])

  const statusChart = useMemo(() => {
    if (!proposals) return []
    const counts: Record<string, number> = {}
    for (const p of proposals) {
      counts[p.status] = (counts[p.status] ?? 0) + 1
    }
    return Object.entries(counts).map(([status, count]) => ({
      status: STATUS_CONFIG[status]?.label ?? status,
      count,
      fill: STATUS_BAR_COLORS[status] ?? "#6b7280",
    }))
  }, [proposals])

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-28 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-64 rounded-lg" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { icon: FileText, label: "Total Proposals", value: String(metrics.total), color: "text-primary", bg: "bg-primary/10" },
          { icon: Trophy, label: "Avg Score", value: metrics.avgScore > 0 ? String(metrics.avgScore) : "--", color: metrics.avgScore > 0 ? scoreColor(metrics.avgScore) : "", bg: "bg-blue-100 dark:bg-blue-900/30" },
          { icon: DollarSign, label: "Revenue Pipeline", value: formatCurrency(metrics.pipeline), color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
          { icon: Percent, label: "Win Rate", value: metrics.winRate > 0 ? `${metrics.winRate}%` : "--", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
        ].map((m) => (
          <Card key={m.label}>
            <CardContent className="pt-6">
              <div className="flex items-center gap-3">
                <div className={`flex h-10 w-10 items-center justify-center rounded-full ${m.bg}`}>
                  <m.icon className={`h-5 w-5 ${m.color}`} />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground">{m.label}</p>
                  <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Status Distribution Bar Chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Proposals by Status</CardTitle>
          <CardDescription>Distribution of proposals across workflow stages</CardDescription>
        </CardHeader>
        <CardContent>
          {statusChart.length > 0 ? (
            <div className="h-[250px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={statusChart}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="status"
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={{ stroke: "hsl(var(--border))" }}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 12 }}
                    axisLine={{ stroke: "hsl(var(--border))" }}
                    tickLine={{ stroke: "hsl(var(--border))" }}
                  />
                  <RechartsTooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]} name="Proposals">
                    {statusChart.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex h-[250px] items-center justify-center text-sm text-muted-foreground">
              No proposal data yet
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Warning / Opportunity generator (deterministic from proposal id) ──

function generateInsights(seed: string) {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0
  const r = (min: number, max: number) => { h = (h * 16807 + 12345) & 0x7fffffff; return min + (h % (max - min + 1)) }

  const allWarnings = [
    "Price above market average on 3 items",
    "Contract duration exceeds 24 months",
    "Missing rebate escalation clause",
    "Below-average compliance score",
    "Limited product category coverage",
  ]
  const allOpportunities = [
    "Volume discount eligible at current spend",
    "Bundle with related categories for 8% savings",
    "Early renewal incentive available",
    "Market share growth potential in 2 facilities",
    "Rebate tier upgrade within reach",
  ]

  const warnCount = r(0, 2)
  const oppCount = r(1, 3)
  const warnings: string[] = []
  const opportunities: string[] = []
  for (let i = 0; i < warnCount; i++) warnings.push(allWarnings[r(0, allWarnings.length - 1)]!)
  for (let i = 0; i < oppCount; i++) opportunities.push(allOpportunities[r(0, allOpportunities.length - 1)]!)
  return { warnings: [...new Set(warnings)], opportunities: [...new Set(opportunities)] }
}

// ─── Proposal Cards (v0 design) ───────────────────────────────

function ProposalCards({
  proposals,
  isLoading,
  onNewProposal,
}: {
  proposals: VendorProposal[]
  isLoading: boolean
  onNewProposal: () => void
}) {
  const [deleteTarget, setDeleteTarget] = useState<VendorProposal | null>(null)
  const [viewTarget, setViewTarget] = useState<VendorProposal | null>(null)

  const enrichedProposals = useMemo(() => {
    return proposals.map((p) => {
      const score = p.dealScore ?? generateDealScore(p.id)
      const insights = generateInsights(p.id)
      return { ...p, computedScore: score, ...insights }
    })
  }, [proposals])

  return (
    <>
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            My Contract Proposals
            <Badge variant="outline" className="font-normal text-xs">
              Internal Use Only
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground">
            Internal vendor analysis documents - edit and rework proposals as needed
          </p>
        </div>
        <Button size="sm" onClick={onNewProposal}>
          <Plus className="mr-2 h-4 w-4" />
          New Proposal
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-48 rounded-lg" />
          ))}
        </div>
      ) : enrichedProposals.length > 0 ? (
        <div className="space-y-4">
          {enrichedProposals.map((p) => (
            <Card key={p.id} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="flex flex-col lg:flex-row">
                  {/* Left: Main info */}
                  <div className="flex-1 p-5 space-y-4">
                    {/* Header row: ID + badges */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-medium text-muted-foreground">
                        #{p.id.slice(0, 8)}
                      </span>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-bold ${
                        p.computedScore.overall >= 80 ? "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
                        : p.computedScore.overall >= 65 ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400"
                        : p.computedScore.overall >= 40 ? "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
                        : "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400"
                      }`}>
                        Score: {p.computedScore.overall}
                      </span>
                      <RecommendationBadge recommendation={p.computedScore.recommendation} />
                      <StatusBadge status={p.status} />
                    </div>

                    {/* Meta row */}
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Building2 className="h-3.5 w-3.5" />
                        {p.facilityIds.length} facilities
                      </span>
                      <span className="flex items-center gap-1">
                        <Package className="h-3.5 w-3.5" />
                        {p.itemCount} products
                      </span>
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {new Date(p.createdAt).toLocaleDateString()}
                      </span>
                      <span className="flex items-center gap-1 font-medium text-foreground">
                        <DollarSign className="h-3.5 w-3.5" />
                        {formatCurrency(p.totalProposedCost)}
                      </span>
                    </div>

                    {/* Warnings & Opportunities */}
                    <div className="flex flex-col gap-2">
                      {p.warnings.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {p.warnings.map((w) => (
                            <span
                              key={w}
                              className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800 ring-1 ring-inset ring-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:ring-amber-800/40"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              {w}
                            </span>
                          ))}
                        </div>
                      )}
                      {p.opportunities.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {p.opportunities.map((o) => (
                            <span
                              key={o}
                              className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-xs text-green-800 ring-1 ring-inset ring-green-200 dark:bg-green-900/20 dark:text-green-400 dark:ring-green-800/40"
                            >
                              <Lightbulb className="h-3 w-3" />
                              {o}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="flex items-center gap-2 border-t p-4 lg:border-l lg:border-t-0 lg:flex-col lg:justify-center lg:px-5">
                    <Button variant="outline" size="sm" className="w-full" onClick={() => setViewTarget(p)}>
                      <Eye className="mr-2 h-4 w-4" />
                      View
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Open menu</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => setDeleteTarget(p)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">No proposals yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a new proposal to get started
            </p>
            <Button size="sm" className="mt-4" onClick={onNewProposal}>
              <Plus className="mr-2 h-4 w-4" />
              New Proposal
            </Button>
          </CardContent>
        </Card>
      )}

      {/* View Proposal Dialog */}
      {viewTarget && (
        <Dialog open onOpenChange={() => setViewTarget(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Proposal Details</DialogTitle>
              <DialogDescription>Proposal #{viewTarget.id.slice(0, 8)}</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                { label: "Status", node: <StatusBadge status={viewTarget.status} /> },
                { label: "Created", node: new Date(viewTarget.createdAt).toLocaleDateString() },
                { label: "Items", node: viewTarget.itemCount },
                { label: "Facilities", node: viewTarget.facilityIds.length },
                { label: "Projected Cost", node: formatCurrency(viewTarget.totalProposedCost) },
                { label: "Deal Score", node: <span className={`font-semibold ${scoreColor(viewTarget.dealScore?.overall ?? generateDealScore(viewTarget.id).overall)}`}>{viewTarget.dealScore?.overall ?? generateDealScore(viewTarget.id).overall}/100</span> },
              ].map((row) => (
                <div key={row.label}>
                  <p className="text-muted-foreground">{row.label}</p>
                  <p className="font-medium">{row.node}</p>
                </div>
              ))}
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setViewTarget(null)}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}

      {/* Delete Confirmation Dialog */}
      {deleteTarget && (
        <Dialog open onOpenChange={() => setDeleteTarget(null)}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Delete Proposal</DialogTitle>
              <DialogDescription>Are you sure? This action cannot be undone.</DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="destructive" onClick={() => setDeleteTarget(null)}>Delete</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ─── Benchmarks Section ───────────────────────────────────────

interface BenchmarkRow {
  id: string
  productName: string
  itemNumber: string
  category: string
  nationalAsp: number
  hardFloor: number
  costBasis: number
  targetMargin: number
  gpoFee: number
}

const DEMO_BENCHMARKS: BenchmarkRow[] = [
  { id: "b1", productName: "Surgical Gloves – Nitrile", itemNumber: "SG-4012", category: "Disposables", nationalAsp: 8.50, hardFloor: 6.80, costBasis: 5.25, targetMargin: 22, gpoFee: 3 },
  { id: "b2", productName: "Hip Implant System II", itemNumber: "HI-7820", category: "Ortho-Spine", nationalAsp: 4250.00, hardFloor: 3600.00, costBasis: 2980.00, targetMargin: 18, gpoFee: 2.5 },
  { id: "b3", productName: "Cardiac Stent – DES", itemNumber: "CS-1105", category: "Cardiovascular", nationalAsp: 1875.00, hardFloor: 1200.00, costBasis: 1350.00, targetMargin: 15, gpoFee: 3 },
  { id: "b4", productName: "Bone Graft Substitute", itemNumber: "BG-3340", category: "Biologics", nationalAsp: 920.00, hardFloor: 700.00, costBasis: 580.00, targetMargin: 20, gpoFee: 2 },
  { id: "b5", productName: "Laparoscopic Stapler", itemNumber: "LS-5560", category: "General Surgery", nationalAsp: 385.00, hardFloor: 310.00, costBasis: 245.00, targetMargin: 18, gpoFee: 3 },
  { id: "b6", productName: "Spinal Fusion Cage", itemNumber: "SF-9001", category: "Ortho-Spine", nationalAsp: 3100.00, hardFloor: 2400.00, costBasis: 2650.00, targetMargin: 16, gpoFee: 2.5 },
  { id: "b7", productName: "Wound Vac Canister", itemNumber: "WV-2200", category: "Disposables", nationalAsp: 42.00, hardFloor: 28.00, costBasis: 22.50, targetMargin: 24, gpoFee: 3 },
  { id: "b8", productName: "Pulse Oximeter Sensor", itemNumber: "PO-8800", category: "Capital Equipment", nationalAsp: 18.75, hardFloor: 14.00, costBasis: 11.00, targetMargin: 20, gpoFee: 2 },
]

function BenchmarksSection({ proposals }: { proposals: VendorProposal[] }) {
  const [importedBenchmarks, setImportedBenchmarks] = useState<BenchmarkRow[]>([])

  const benchmarks = useMemo<BenchmarkRow[]>(() => {
    if (importedBenchmarks.length > 0) return importedBenchmarks
    return DEMO_BENCHMARKS
  }, [importedBenchmarks])

  function handleBenchmarkImport() {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".csv,.xlsx,.xls"
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0]
      if (!file) return

      try {
        let headers: string[] = []
        let rows: Record<string, string>[] = []

        const ext = file.name.split(".").pop()?.toLowerCase()
        if (ext === "csv") {
          const text = await file.text()
          const lines = text.split(/\r?\n/).filter((l) => l.trim())
          headers = lines[0]?.split(",").map((h) => h.trim()) ?? []
          rows = lines.slice(1).map((line) => {
            const vals = line.split(",").map((v) => v.trim())
            const row: Record<string, string> = {}
            headers.forEach((h, i) => { row[h] = vals[i] ?? "" })
            return row
          })
        } else {
          const formData = new FormData()
          formData.append("file", file)
          const res = await fetch("/api/parse-file", { method: "POST", body: formData })
          if (!res.ok) throw new Error("Failed to parse file")
          const data = await res.json()
          headers = data.headers
          rows = data.rows
        }

        const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")
        const nh = headers.map(norm)
        const find = (...aliases: string[]) => aliases.map(norm).reduce<number>((f, a) => f >= 0 ? f : nh.indexOf(a), -1)

        const iProduct = find("product", "productname", "item", "itemname", "description")
        const iItemNo = find("itemnumber", "itemno", "sku", "referencenumber", "catalogno", "partno")
        const iCategory = find("category", "productcategory", "department")
        const iAsp = find("nationalasp", "asp", "averagesalesprice", "avgprice")
        const iFloor = find("hardfloor", "floor", "minimumprice", "floorprice")
        const iCost = find("costbasis", "cost", "unitcost", "cogs")
        const iMargin = find("targetmargin", "margin", "marginpercent")
        const iGpo = find("gpofee", "gpo", "adminfee", "fee")

        const parsed: BenchmarkRow[] = rows.map((r, i) => {
          const g = (idx: number) => idx >= 0 ? r[headers[idx]] ?? "" : ""
          return {
            id: `imp-${i}`,
            productName: g(iProduct) || `Item ${i + 1}`,
            itemNumber: g(iItemNo) || "",
            category: g(iCategory) || "Uncategorized",
            nationalAsp: parseFloat(g(iAsp).replace(/[^0-9.-]/g, "")) || 0,
            hardFloor: parseFloat(g(iFloor).replace(/[^0-9.-]/g, "")) || 0,
            costBasis: parseFloat(g(iCost).replace(/[^0-9.-]/g, "")) || 0,
            targetMargin: parseFloat(g(iMargin).replace(/[^0-9.-]/g, "")) || 0,
            gpoFee: parseFloat(g(iGpo).replace(/[^0-9.-]/g, "")) || 0,
          }
        }).filter((r) => r.productName && (r.nationalAsp > 0 || r.costBasis > 0))

        if (parsed.length === 0) {
          toast.error("No valid benchmark data found. Check your CSV has columns like Product, National ASP, Hard Floor, Cost Basis.")
          return
        }

        setImportedBenchmarks(parsed)
        toast.success(`Imported ${parsed.length} benchmark items from ${file.name}`)
      } catch {
        toast.error("Failed to parse benchmark file")
      }
    }
    input.click()
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Scale className="h-5 w-5" />
              Product Pricing Benchmarks
            </CardTitle>
            <CardDescription>
              Compare your pricing and terms against national averages and hard floors
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBenchmarkImport}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => toast.info("Export started. Your benchmarks CSV will download shortly.")}
            >
              <Download className="h-4 w-4 mr-1" />
              Export
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {benchmarks.length === 0 ? (
          <div className="py-12 text-center">
            <Scale className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="font-medium text-muted-foreground">No benchmark data yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Import a benchmarks file to compare your pricing against market data
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={handleBenchmarkImport}
            >
              <Upload className="h-4 w-4 mr-1" />
              Import Benchmarks
            </Button>
          </div>
        ) : (
          <>
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Product</TableHead>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">National ASP</TableHead>
                    <TableHead className="text-right">Hard Floor</TableHead>
                    <TableHead className="text-right">Cost Basis</TableHead>
                    <TableHead className="text-right">Target Margin</TableHead>
                    <TableHead className="text-right">GPO Fee</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {benchmarks.map((row) => {
                    const floorBelowCost = row.hardFloor < row.costBasis
                    return (
                      <TableRow key={row.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{row.productName}</p>
                            <p className="text-xs text-muted-foreground">{row.itemNumber}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{row.category}</Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">
                          {formatCurrency(row.nationalAsp)}
                        </TableCell>
                        <TableCell className={`text-right font-medium ${floorBelowCost ? "text-red-600 dark:text-red-400" : ""}`}>
                          {formatCurrency(row.hardFloor)}
                          {floorBelowCost && (
                            <AlertTriangle className="inline-block ml-1 h-3 w-3" />
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(row.costBasis)}
                        </TableCell>
                        <TableCell className="text-right">
                          {row.targetMargin}%
                        </TableCell>
                        <TableCell className="text-right">
                          {row.gpoFee}%
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="mt-4 pt-4 border-t flex items-center justify-between text-sm text-muted-foreground">
              <span>{benchmarks.length} products benchmarked</span>
              <span className="flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 text-red-500" />
                Red = Hard Floor below Cost Basis
              </span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Top-level Metrics ─────────────────────────────────────────

function TopMetrics({ proposals, totalProposals, totalProjectedSpend }: {
  proposals: VendorProposal[]; totalProposals: number; totalProjectedSpend: number
}) {
  const scored = proposals.filter((p) => p.dealScore)
  const avgScore = scored.length > 0
    ? Math.round(scored.reduce((s, p) => s + (p.dealScore?.overall ?? 0), 0) / scored.length)
    : null
  const acceptable = proposals.filter(
    (p) => p.dealScore && (p.dealScore.recommendation === "accept" || p.dealScore.recommendation === "strong_accept")
  ).length

  const cards = [
    { icon: FileText, title: "Total Proposals", value: String(totalProposals), sub: `${scored.length} scored` },
    { icon: Gauge, title: "Avg Deal Score", value: avgScore ? String(avgScore) : "-", sub: "Across scored deals" },
    { icon: CheckCircle2, title: "Acceptable Deals", value: String(acceptable), sub: "Score 75+ recommended", valueClass: "text-green-600" },
    { icon: DollarSign, title: "Total Projected Spend", value: formatCurrency(totalProjectedSpend), sub: "Across all proposals" },
  ]

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => (
        <Card key={c.title}>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">{c.title}</CardTitle>
            <c.icon className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${c.valueClass ?? ""}`}>{c.value}</div>
            <p className="text-xs text-muted-foreground">{c.sub}</p>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Main Component ────────────────────────────────────────────

interface VendorProspectiveClientProps {
  vendorId: string
}

export function VendorProspectiveClient({ vendorId }: VendorProspectiveClientProps) {
  const { data: proposals, isLoading } = useVendorProposals(vendorId)
  const [activeTab, setActiveTab] = useState("opportunities")

  const totalProposals = proposals?.length ?? 0
  const totalProjectedSpend = proposals?.reduce((s, p) => s + p.totalProposedCost, 0) ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Prospective Analysis"
        description="Analyze opportunities and propose new contracts to facilities"
      />

      {/* Top-level Metrics */}
      <TopMetrics proposals={proposals ?? []} totalProposals={totalProposals} totalProjectedSpend={totalProjectedSpend} />

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="proposals">My Proposals</TabsTrigger>
          <TabsTrigger value="deal-scorer" className="gap-2">
            <Gauge className="h-4 w-4" />
            Deal Scorer
          </TabsTrigger>
          <TabsTrigger value="benchmarks" className="gap-2">
            <Scale className="h-4 w-4" />
            Benchmarks
          </TabsTrigger>
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
        </TabsList>

        {/* Opportunities Tab */}
        <TabsContent value="opportunities" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              { icon: Target, label: "Total Opportunities", value: String(totalProposals), color: "text-primary", bg: "bg-primary/10" },
              { icon: TrendingUp, label: "Potential Revenue", value: formatCurrency(totalProjectedSpend), color: "text-green-600", bg: "bg-green-100 dark:bg-green-900/30" },
              { icon: ArrowUpRight, label: "Avg Growth Potential", value: "--", color: "text-amber-600", bg: "bg-amber-100 dark:bg-amber-900/30" },
              { icon: Gauge, label: "Avg Opportunity Score", value: "--", color: "text-blue-600", bg: "bg-blue-100 dark:bg-blue-900/30" },
            ].map((m) => (
              <Card key={m.label}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-10 w-10 items-center justify-center rounded-full ${m.bg}`}>
                      <m.icon className={`h-5 w-5 ${m.color}`} />
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground">{m.label}</p>
                      <p className={`text-2xl font-bold ${m.color}`}>{m.value}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Facility Opportunities</CardTitle>
              <CardDescription>
                Upload COG/usage data to see real facility opportunities based on actual spend
                patterns
              </CardDescription>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-md" />
                  ))}
                </div>
              ) : proposals && proposals.length > 0 ? (
                <div className="space-y-4">
                  {proposals.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between p-4 rounded-lg border bg-card hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex items-center gap-4">
                        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                          <Target className="h-5 w-5 text-primary" />
                        </div>
                        <div>
                          <p className="font-medium">
                            {p.itemCount} items &middot; {formatCurrency(p.totalProposedCost)}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            {p.facilityIds.length} facilities &middot;{" "}
                            {new Date(p.createdAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-xs text-muted-foreground">Projected Spend</p>
                          <p className="font-medium text-primary">
                            {formatCurrency(p.totalProposedCost)}
                          </p>
                        </div>
                        <StatusBadge status={p.status} />
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Target className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p className="font-medium">No facility opportunities yet</p>
                  <p className="text-sm mt-1">
                    Create a new proposal to get started
                  </p>
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={() => setActiveTab("new-proposal")}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    New Proposal
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Proposals Tab (Card-based) */}
        <TabsContent value="proposals" className="mt-4 space-y-4">
          <ProposalCards
            proposals={proposals ?? []}
            isLoading={isLoading}
            onNewProposal={() => setActiveTab("analytics")}
          />
        </TabsContent>

        {/* Deal Scorer Tab */}
        <TabsContent value="deal-scorer" className="mt-4 space-y-4">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-20 rounded-lg" />
              <Skeleton className="h-[380px] rounded-lg" />
            </div>
          ) : (
            <DealScorerSection proposals={proposals ?? []} />
          )}
        </TabsContent>

        {/* Benchmarks Tab */}
        <TabsContent value="benchmarks" className="mt-4 space-y-4">
          <BenchmarksSection proposals={proposals ?? []} />
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          <AnalyticsSection proposals={proposals ?? []} isLoading={isLoading} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
