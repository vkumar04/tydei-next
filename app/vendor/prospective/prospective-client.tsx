"use client"

import { useState, useMemo } from "react"
import { PageHeader } from "@/components/shared/page-header"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
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
} from "lucide-react"
import { ProposalBuilder } from "@/components/vendor/prospective/proposal-builder"
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

// ─── Enhanced Proposals Table ──────────────────────────────────

function ProposalsTable({
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

  const scoredProposals = useMemo(() => {
    return proposals.map((p) => ({
      ...p,
      computedScore: p.dealScore ?? generateDealScore(p.id),
    }))
  }, [proposals])

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                My Contract Proposals
                <Badge variant="outline" className="font-normal text-xs">
                  Internal Use Only
                </Badge>
              </CardTitle>
              <CardDescription>
                Internal vendor analysis documents - edit and rework proposals as needed
              </CardDescription>
            </div>
            <Button size="sm" onClick={onNewProposal}>
              <Plus className="mr-2 h-4 w-4" />
              New Proposal
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-16 rounded-md" />
              ))}
            </div>
          ) : scoredProposals.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Proposal</TableHead>
                  <TableHead>Facilities</TableHead>
                  <TableHead className="text-right">Projected Cost</TableHead>
                  <TableHead className="text-right">Items</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scoredProposals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium font-mono text-xs">
                      {p.id.slice(0, 8)}...
                    </TableCell>
                    <TableCell>{p.facilityIds.length} facilities</TableCell>
                    <TableCell className="text-right">
                      {formatCurrency(p.totalProposedCost)}
                    </TableCell>
                    <TableCell className="text-right">{p.itemCount}</TableCell>
                    <TableCell className="text-center">
                      <span className={`font-semibold ${scoreColor(p.computedScore.overall)}`}>
                        {p.computedScore.overall}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={p.status} />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell className="text-right">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="h-4 w-4" />
                            <span className="sr-only">Open menu</span>
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => setViewTarget(p)}>
                            <Eye className="mr-2 h-4 w-4" />
                            View
                          </DropdownMenuItem>
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
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="py-8 text-center text-sm text-muted-foreground">
              No proposals yet
            </p>
          )}
        </CardContent>
      </Card>

      {/* View Proposal Dialog */}
      {viewTarget && (
        <Dialog open onOpenChange={() => setViewTarget(null)}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Proposal Details</DialogTitle>
              <DialogDescription>Proposal {viewTarget.id.slice(0, 8)}...</DialogDescription>
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
          <TabsTrigger value="analytics" className="gap-2">
            <BarChart3 className="h-4 w-4" />
            Analytics
          </TabsTrigger>
          <TabsTrigger value="new-proposal" className="gap-2">
            <Plus className="h-4 w-4" />
            New Proposal
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

        {/* Proposals Tab (Enhanced) */}
        <TabsContent value="proposals" className="mt-4 space-y-4">
          <ProposalsTable
            proposals={proposals ?? []}
            isLoading={isLoading}
            onNewProposal={() => setActiveTab("new-proposal")}
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

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="mt-4 space-y-4">
          <AnalyticsSection proposals={proposals ?? []} isLoading={isLoading} />
        </TabsContent>

        {/* New Proposal Tab */}
        <TabsContent value="new-proposal" className="mt-4">
          <ProposalBuilder vendorId={vendorId} facilities={[]} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
