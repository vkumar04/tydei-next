"use client"

/**
 * Compare-Scenarios Table.
 *
 * Side-by-side comparison of every scenario the user has built. Highlights
 * the optimal row (max rebate delta) and offers per-row removal.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Crown, Trash2 } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import type { SavedScenario } from "./scenario-types"

interface CompareScenariosTableProps {
  scenarios: SavedScenario[]
  optimalId: string | null
  onRemove: (id: string) => void
  onClearAll: () => void
}

export function CompareScenariosTable({
  scenarios,
  optimalId,
  onRemove,
  onClearAll,
}: CompareScenariosTableProps) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Compare Scenarios</CardTitle>
            <CardDescription>
              Side-by-side view of every scenario you've built. The crown marks
              the highest rebate uplift.
            </CardDescription>
          </div>
          {scenarios.length > 0 && (
            <Button variant="outline" size="sm" onClick={onClearAll}>
              Clear All
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {scenarios.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No scenarios yet. Use the builder above to add one.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]"></TableHead>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Rebate Type</TableHead>
                  <TableHead className="text-right">Projected Spend</TableHead>
                  <TableHead className="text-right">Projected Tier</TableHead>
                  <TableHead className="text-right">Projected Rebate</TableHead>
                  <TableHead className="text-right">Rebate Delta</TableHead>
                  <TableHead className="w-[80px] text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scenarios.map((s) => {
                  const isOptimal = s.id === optimalId
                  return (
                    <TableRow
                      key={s.id}
                      className={
                        isOptimal
                          ? "bg-emerald-50/50 dark:bg-emerald-950/20"
                          : undefined
                      }
                    >
                      <TableCell>
                        {isOptimal && (
                          <Crown
                            className="h-4 w-4 text-emerald-600 dark:text-emerald-400"
                            aria-label="Optimal scenario"
                          />
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{s.input.vendorName}</div>
                        <div className="text-xs text-muted-foreground">
                          {s.input.contractName}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {s.input.rebateType.replaceAll("_", " ")}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(s.evaluation.projectedSpend)}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.evaluation.projectedTierNumber !== null
                          ? `Tier ${s.evaluation.projectedTierNumber}`
                          : "Below Tier 1"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(s.evaluation.projectedRebate)}
                      </TableCell>
                      <TableCell
                        className={
                          s.evaluation.rebateDelta > 0
                            ? "text-right font-medium text-emerald-600 dark:text-emerald-400"
                            : "text-right text-muted-foreground"
                        }
                      >
                        {s.evaluation.rebateDelta > 0
                          ? `+${formatCurrency(s.evaluation.rebateDelta)}`
                          : formatCurrency(0)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onRemove(s.id)}
                          aria-label={`Remove scenario ${s.input.label}`}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
