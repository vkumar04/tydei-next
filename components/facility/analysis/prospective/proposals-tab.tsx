"use client"

/**
 * Proposals tab — list of all session-scoped scored proposals with quick
 * select for the comparison tab (spec §subsystem-4).
 */

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
import { ArrowRight, Trash2 } from "lucide-react"
import type { ScoredProposal } from "./types"

interface ProposalsTabProps {
  proposals: ScoredProposal[]
  comparisonSelection: string[]
  onToggleCompare: (id: string) => void
  onOpenCompare: () => void
  onRemove: (id: string) => void
}

function verdictBadge(v: "accept" | "negotiate" | "decline") {
  if (v === "accept")
    return (
      <Badge
        variant="outline"
        className="bg-emerald-100 text-emerald-800 border-emerald-300"
      >
        Accept
      </Badge>
    )
  if (v === "negotiate")
    return (
      <Badge
        variant="outline"
        className="bg-amber-100 text-amber-800 border-amber-300"
      >
        Negotiate
      </Badge>
    )
  return (
    <Badge
      variant="outline"
      className="bg-red-100 text-red-800 border-red-300"
    >
      Decline
    </Badge>
  )
}

export function ProposalsTab({
  proposals,
  comparisonSelection,
  onToggleCompare,
  onOpenCompare,
  onRemove,
}: ProposalsTabProps) {
  if (proposals.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>No proposals yet</CardTitle>
          <CardDescription>
            Upload a PDF or use the Manual tab to score a proposal. Session-scoped
            — not persisted.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>Scored proposals</CardTitle>
            <CardDescription>
              {proposals.length} scored · select 2 to compare
            </CardDescription>
          </div>
          <Button
            disabled={comparisonSelection.length !== 2}
            onClick={onOpenCompare}
          >
            Compare selected
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">Select</TableHead>
              <TableHead>Vendor</TableHead>
              <TableHead>Source</TableHead>
              <TableHead>Overall</TableHead>
              <TableHead>Verdict</TableHead>
              <TableHead>Scored</TableHead>
              <TableHead className="w-[40px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposals.map((p) => {
              const checked = comparisonSelection.includes(p.id)
              const disabled =
                !checked && comparisonSelection.length >= 2
              return (
                <TableRow key={p.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={disabled}
                      onChange={() => onToggleCompare(p.id)}
                      aria-label={`Select ${p.vendorName} for comparison`}
                    />
                  </TableCell>
                  <TableCell className="font-medium">{p.vendorName}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {p.source === "upload" ? "PDF" : "Manual"}
                  </TableCell>
                  <TableCell className="font-mono">
                    {p.result.scores.overall.toFixed(1)}
                  </TableCell>
                  <TableCell>
                    {verdictBadge(p.result.recommendation.verdict)}
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    {new Date(p.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => onRemove(p.id)}
                      aria-label={`Remove ${p.vendorName}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
