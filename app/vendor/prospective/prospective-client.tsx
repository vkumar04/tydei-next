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
  FileText,
  DollarSign,
  CheckCircle2,
  Target,
  TrendingUp,
  ArrowUpRight,
  Gauge,
  Plus,
  AlertTriangle,
} from "lucide-react"
import { ProposalBuilder } from "@/components/vendor/prospective/proposal-builder"
import { DealScoreView } from "@/components/vendor/prospective/deal-score-view"
import { useVendorProposals } from "@/hooks/use-prospective"
import { formatCurrency } from "@/lib/formatting"

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

      {/* Metrics */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Proposals
            </CardTitle>
            <FileText className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{totalProposals}</div>
            <p className="text-xs text-muted-foreground">
              {proposals?.filter((p) => p.dealScore).length ?? 0} scored
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Avg Deal Score
            </CardTitle>
            <Gauge className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {proposals && proposals.filter((p) => p.dealScore).length > 0
                ? Math.round(
                    proposals
                      .filter((p) => p.dealScore)
                      .reduce((s, p) => s + (p.dealScore?.overall ?? 0), 0) /
                      proposals.filter((p) => p.dealScore).length
                  )
                : "-"}
            </div>
            <p className="text-xs text-muted-foreground">Across scored deals</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Acceptable Deals
            </CardTitle>
            <CheckCircle2 className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">
              {proposals?.filter(
                (p) =>
                  p.dealScore &&
                  (p.dealScore.recommendation === "accept" ||
                    p.dealScore.recommendation === "strong_accept")
              ).length ?? 0}
            </div>
            <p className="text-xs text-muted-foreground">Score 75+ recommended</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Total Projected Spend
            </CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(totalProjectedSpend)}</div>
            <p className="text-xs text-muted-foreground">Across all proposals</p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="opportunities">Opportunities</TabsTrigger>
          <TabsTrigger value="proposals">My Proposals</TabsTrigger>
          <TabsTrigger value="new-proposal" className="gap-2">
            <Plus className="h-4 w-4" />
            New Proposal
          </TabsTrigger>
        </TabsList>

        {/* Opportunities Tab */}
        <TabsContent value="opportunities" className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
                    <Target className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Total Opportunities</p>
                    <p className="text-2xl font-bold">{totalProposals}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                    <TrendingUp className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Potential Revenue</p>
                    <p className="text-2xl font-bold text-green-600">
                      {formatCurrency(totalProjectedSpend)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
                    <ArrowUpRight className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Growth Potential</p>
                    <p className="text-2xl font-bold text-amber-600">--</p>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30">
                    <Gauge className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Avg Opportunity Score</p>
                    <p className="text-2xl font-bold text-blue-600">--</p>
                  </div>
                </div>
              </CardContent>
            </Card>
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
                        <Badge variant="secondary">{p.status}</Badge>
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

        {/* Proposals Tab */}
        <TabsContent value="proposals" className="mt-4 space-y-4">
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
                <Button size="sm" onClick={() => setActiveTab("new-proposal")}>
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
              ) : proposals && proposals.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Proposal</TableHead>
                      <TableHead>Facilities</TableHead>
                      <TableHead className="text-right">Projected Cost</TableHead>
                      <TableHead className="text-right">Items</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {proposals.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell className="font-medium">{p.id}</TableCell>
                        <TableCell>{p.facilityIds.length} facilities</TableCell>
                        <TableCell className="text-right">
                          {formatCurrency(p.totalProposedCost)}
                        </TableCell>
                        <TableCell className="text-right">{p.itemCount}</TableCell>
                        <TableCell>
                          <Badge variant="secondary">{p.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(p.createdAt).toLocaleDateString()}
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
        </TabsContent>

        {/* New Proposal Tab */}
        <TabsContent value="new-proposal" className="mt-4">
          <ProposalBuilder vendorId={vendorId} facilities={[]} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
