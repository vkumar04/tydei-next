"use client"

import { useState, useMemo } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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
import {
  Search,
  User,
  Activity,
  BarChart3,
  DollarSign,
  TrendingUp,
  TrendingDown,
  ChevronRight,
} from "lucide-react"
import type { SurgeonScorecard } from "@/lib/actions/cases"
import { SurgeonDetailDialog } from "./surgeon-scorecard"

interface SurgeonScorecardsGridProps {
  scorecards: SurgeonScorecard[]
  avgCostPerCase?: number
}

export function SurgeonScorecardsGrid({
  scorecards,
  avgCostPerCase = 0,
}: SurgeonScorecardsGridProps) {
  const [search, setSearch] = useState("")
  const [sortBy, setSortBy] = useState("cases")
  const [selectedSurgeon, setSelectedSurgeon] =
    useState<SurgeonScorecard | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  /* ── Derived data ────────────────────────────────────────────── */

  const filtered = useMemo(() => {
    const list = scorecards.filter((s) =>
      s.surgeonName.toLowerCase().includes(search.toLowerCase())
    )

    list.sort((a, b) => {
      switch (sortBy) {
        case "cases":
          return b.caseCount - a.caseCount
        case "margin":
          return b.totalMargin - a.totalMargin
        case "spend":
          return a.avgSpendPerCase - b.avgSpendPerCase
        case "compliance":
          return b.complianceRate - a.complianceRate
        default:
          return b.caseCount - a.caseCount
      }
    })

    return list
  }, [scorecards, search, sortBy])

  /* ── Totals ──────────────────────────────────────────────────── */

  const totals = useMemo(() => {
    const totalCases = scorecards.reduce((s, sc) => s + sc.caseCount, 0)
    const totalMargin = scorecards.reduce((s, sc) => s + sc.totalMargin, 0)
    const avgCompliance =
      scorecards.length > 0
        ? Math.round(
            scorecards.reduce((s, sc) => s + sc.complianceRate, 0) /
              scorecards.length
          )
        : 0
    return { totalCases, totalMargin, avgCompliance }
  }, [scorecards])

  /* ── Facility averages ───────────────────────────────────────── */

  const facilityAvg = useMemo(() => {
    if (scorecards.length === 0) return { avgSpend: 0, avgOnContract: 0 }
    const avgSpend = Math.round(
      scorecards.reduce((s, sc) => s + sc.avgSpendPerCase, 0) /
        scorecards.length
    )
    const avgOnContract = Math.round(
      scorecards.reduce((s, sc) => s + sc.onContractPercent, 0) /
        scorecards.length
    )
    return { avgSpend, avgOnContract }
  }, [scorecards])

  /* ── Render ──────────────────────────────────────────────────── */

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Total Surgeons
              </span>
            </div>
            <div className="text-2xl font-bold mt-1">{scorecards.length}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Total Cases
              </span>
            </div>
            <div className="text-2xl font-bold mt-1">
              {totals.totalCases.toLocaleString()}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Avg Compliance
              </span>
            </div>
            <div className="text-2xl font-bold mt-1 text-primary">
              {totals.avgCompliance}%
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-muted-foreground">
                Total Margin
              </span>
            </div>
            <div className="text-2xl font-bold mt-1 text-green-600 dark:text-green-400">
              ${Math.round(totals.totalMargin).toLocaleString()}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search surgeons..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={sortBy} onValueChange={setSortBy}>
          <SelectTrigger className="w-[200px]">
            <SelectValue placeholder="Sort by" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cases">Total Cases</SelectItem>
            <SelectItem value="margin">Gross Margin</SelectItem>
            <SelectItem value="spend">Avg Spend (Low to High)</SelectItem>
            <SelectItem value="compliance">Compliance Rate</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Facility Averages Reference */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">
            Facility Averages (Reference)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-8 text-sm flex-wrap">
            <div>
              <span className="text-muted-foreground">Avg Spend/Case:</span>{" "}
              <span className="font-semibold">
                ${avgCostPerCase > 0 ? Math.round(avgCostPerCase).toLocaleString() : facilityAvg.avgSpend.toLocaleString()}
              </span>
            </div>
            <div>
              <span className="text-muted-foreground">On-Contract %:</span>{" "}
              <span className="font-semibold">{facilityAvg.avgOnContract}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Surgeons Table */}
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Surgeon</TableHead>
                <TableHead className="text-center">Cases</TableHead>
                <TableHead className="text-center">Avg Spend</TableHead>
                <TableHead className="text-center">Supply Util</TableHead>
                <TableHead className="text-center">Compliance</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right">Trend</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No surgeons found.
                  </TableCell>
                </TableRow>
              ) : (
                filtered.map((sc) => {
                  const isBelowAvg =
                    avgCostPerCase > 0 &&
                    sc.avgSpendPerCase < avgCostPerCase * 0.9
                  const isAboveAvg =
                    avgCostPerCase > 0 &&
                    sc.avgSpendPerCase > avgCostPerCase * 1.1

                  return (
                    <TableRow
                      key={sc.surgeonName}
                      className="cursor-pointer hover:bg-muted/50"
                      onClick={() => {
                        setSelectedSurgeon(sc)
                        setDetailOpen(true)
                      }}
                    >
                      <TableCell>
                        <div className="font-medium">{sc.surgeonName}</div>
                      </TableCell>
                      <TableCell className="text-center font-semibold">
                        {sc.caseCount}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={
                            isBelowAvg
                              ? "text-emerald-600 dark:text-emerald-400 font-medium"
                              : isAboveAvg
                                ? "text-red-600 dark:text-red-400 font-medium"
                                : ""
                          }
                        >
                          ${Math.round(sc.avgSpendPerCase).toLocaleString()}
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            sc.onContractPercent >= 80
                              ? "default"
                              : sc.onContractPercent >= 50
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {Math.round(sc.onContractPercent)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge
                          variant={
                            sc.complianceRate >= 80
                              ? "default"
                              : sc.complianceRate >= 60
                                ? "secondary"
                                : "outline"
                          }
                        >
                          {Math.round(sc.complianceRate)}%
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-semibold text-green-600 dark:text-green-400">
                          ${Math.round(sc.totalMargin).toLocaleString()}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {sc.marginPercent}%
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        {sc.trend === "up" ? (
                          <TrendingUp className="h-4 w-4 text-green-500" />
                        ) : (
                          <TrendingDown className="h-4 w-4 text-red-500" />
                        )}
                      </TableCell>
                      <TableCell>
                        <Button variant="ghost" size="sm">
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Surgeon Detail Dialog */}
      <SurgeonDetailDialog
        surgeon={selectedSurgeon}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        peers={scorecards}
      />
    </div>
  )
}
