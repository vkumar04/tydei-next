"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { X } from "lucide-react"
import type { ProposalAnalysis } from "@/lib/actions/prospective"

export interface ProposalListTabProps {
  analysis: ProposalAnalysis
  formatCurrency: (value: number) => string
  onSelectProposal: () => void
  onDeleteProposal: () => void
}

export function ProposalListTab({
  analysis,
  formatCurrency,
  onSelectProposal,
  onDeleteProposal,
}: ProposalListTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Analyzed Proposals</CardTitle>
        <CardDescription>
          All proposals you&apos;ve uploaded or entered for analysis
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Items</TableHead>
              <TableHead>Current Cost</TableHead>
              <TableHead>Proposed Cost</TableHead>
              <TableHead>Score</TableHead>
              <TableHead>Recommendation</TableHead>
              <TableHead>Savings</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow
              className="cursor-pointer"
              onClick={onSelectProposal}
            >
              <TableCell className="font-medium">
                {analysis.itemComparisons.length} items
              </TableCell>
              <TableCell>
                {formatCurrency(analysis.totalCurrentCost)}
              </TableCell>
              <TableCell>
                {formatCurrency(analysis.totalProposedCost)}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    analysis.dealScore.overall >= 65
                      ? "default"
                      : analysis.dealScore.overall >= 40
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {analysis.dealScore.overall}/100
                </Badge>
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    analysis.dealScore.recommendation ===
                      "strong_accept" ||
                    analysis.dealScore.recommendation === "accept"
                      ? "default"
                      : analysis.dealScore.recommendation === "reject"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {analysis.dealScore.recommendation === "strong_accept"
                    ? "Favorable"
                    : analysis.dealScore.recommendation === "accept"
                      ? "Favorable"
                      : analysis.dealScore.recommendation === "reject"
                        ? "Not Recommended"
                        : "Needs Negotiation"}
                </Badge>
              </TableCell>
              <TableCell
                className={
                  analysis.totalSavings >= 0
                    ? "text-emerald-600 dark:text-emerald-400"
                    : "text-red-600 dark:text-red-400"
                }
              >
                {formatCurrency(analysis.totalSavings)} (
                {analysis.totalSavingsPercent.toFixed(1)}%)
              </TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDeleteProposal()
                  }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
