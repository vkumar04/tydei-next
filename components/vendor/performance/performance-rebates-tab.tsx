"use client"

import { Building2, CheckCircle2, FileText, Target } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
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
  formatPerfCurrency,
  type ContractPerf,
  type ContractPerfTier,
} from "./performance-types"

export interface PerformanceRebatesTabProps {
  allContracts: ContractPerf[]
  filteredContracts: ContractPerf[]
  displayedRebateTiers: ContractPerfTier[]
  uniqueFacilities: string[]
  rebateContractFilter: string
  rebateFacilityFilter: string
  onContractFilterChange: (next: string) => void
  onFacilityFilterChange: (next: string) => void
  onClearFilters: () => void
  totalRebatesPaid: number
  totalActualSpend: number
}

export function PerformanceRebatesTab({
  allContracts,
  filteredContracts,
  displayedRebateTiers,
  uniqueFacilities,
  rebateContractFilter,
  rebateFacilityFilter,
  onContractFilterChange,
  onFacilityFilterChange,
  onClearFilters,
  totalRebatesPaid,
  totalActualSpend,
}: PerformanceRebatesTabProps) {
  const tierContext =
    rebateContractFilter !== "all"
      ? `Progress for ${allContracts.find((c) => c.id === rebateContractFilter)?.name ?? "selected contract"}`
      : rebateFacilityFilter !== "all"
        ? `Progress for ${rebateFacilityFilter}`
        : "Aggregated progress across all contracts"

  const hasActiveFilter =
    rebateContractFilter !== "all" || rebateFacilityFilter !== "all"

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">Filter by:</span>
            </div>
            <Select value={rebateContractFilter} onValueChange={onContractFilterChange}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder="All Contracts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Contracts</SelectItem>
                {allContracts.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={rebateFacilityFilter} onValueChange={onFacilityFilterChange}>
              <SelectTrigger className="w-[200px]">
                <Building2 className="h-4 w-4 mr-2" />
                <SelectValue placeholder="All Facilities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Facilities</SelectItem>
                {uniqueFacilities.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {hasActiveFilter && (
              <Button variant="ghost" size="sm" onClick={onClearFilters}>
                Clear Filters
              </Button>
            )}
            <div className="ml-auto text-sm text-muted-foreground">
              Showing {filteredContracts.length} of {allContracts.length} contracts
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Contract Rebate Performance</CardTitle>
          <CardDescription>Rebate progress by individual contract</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Contract</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead className="text-right">Target Spend</TableHead>
                <TableHead className="text-right">Actual Spend</TableHead>
                <TableHead className="text-right">Rebate Rate</TableHead>
                <TableHead className="text-right">Rebate Paid</TableHead>
                <TableHead className="text-right">Progress</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredContracts.map((contract) => (
                <TableRow key={contract.id}>
                  <TableCell className="font-medium">{contract.name}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {contract.facility}
                    </div>
                  </TableCell>
                  <TableCell className="text-right">{formatPerfCurrency(contract.targetSpend)}</TableCell>
                  <TableCell className="text-right">{formatPerfCurrency(contract.actualSpend)}</TableCell>
                  <TableCell className="text-right">{contract.rebateRate}%</TableCell>
                  <TableCell className="text-right font-medium text-emerald-600 dark:text-emerald-400">
                    {formatPerfCurrency(contract.rebatePaid)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Progress value={Math.min(contract.compliance, 100)} className="w-20 h-2" />
                      <span className="text-sm w-12">{contract.compliance}%</span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {filteredContracts.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    No contracts match the selected filters
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {filteredContracts.length > 0 && (
            <div className="mt-4 pt-4 border-t grid grid-cols-4 gap-4 text-center">
              <div>
                <div className="text-sm text-muted-foreground">Total Target</div>
                <div className="font-bold">
                  {formatPerfCurrency(filteredContracts.reduce((s, c) => s + c.targetSpend, 0))}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Actual</div>
                <div className="font-bold">
                  {formatPerfCurrency(filteredContracts.reduce((s, c) => s + c.actualSpend, 0))}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Total Rebates</div>
                <div className="font-bold text-emerald-600 dark:text-emerald-400">
                  {formatPerfCurrency(filteredContracts.reduce((s, c) => s + c.rebatePaid, 0))}
                </div>
              </div>
              <div>
                <div className="text-sm text-muted-foreground">Avg Compliance</div>
                <div className="font-bold">
                  {(
                    filteredContracts.reduce((s, c) => s + c.compliance, 0) / filteredContracts.length
                  ).toFixed(1)}
                  %
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rebate Tier Progress</CardTitle>
            <CardDescription>{tierContext}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {displayedRebateTiers.map((tier) => (
              <div key={tier.tier} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{tier.tier}</span>
                    <Badge variant="outline">{tier.rebateRate}% rebate</Badge>
                  </div>
                  {tier.achieved ? (
                    <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100">
                      <CheckCircle2 className="h-3 w-3 mr-1" />
                      Achieved
                    </Badge>
                  ) : (
                    <span className="text-sm text-muted-foreground">
                      {formatPerfCurrency(tier.threshold - tier.current)} to go
                    </span>
                  )}
                </div>
                <Progress
                  value={Math.min((tier.current / tier.threshold) * 100, 100)}
                  className="h-3"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{formatPerfCurrency(tier.current)}</span>
                  <span>{formatPerfCurrency(tier.threshold)}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Rebate Summary</CardTitle>
            <CardDescription>Year-to-date rebate performance</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                  {formatPerfCurrency(totalRebatesPaid)}
                </div>
                <div className="text-sm text-muted-foreground">Total Paid YTD</div>
              </div>
              <div className="rounded-lg border p-4 text-center">
                <div className="text-2xl font-bold">
                  {((totalRebatesPaid / (totalActualSpend || 1)) * 100).toFixed(1)}%
                </div>
                <div className="text-sm text-muted-foreground">Effective Rate</div>
              </div>
            </div>
            <div className="rounded-lg bg-muted/50 p-4">
              <div className="flex items-center gap-2 mb-2">
                <Target className="h-4 w-4 text-primary" />
                <span className="font-medium">Next Tier Goal</span>
              </div>
              <p className="text-sm text-muted-foreground">
                Achieve {formatPerfCurrency(2000000)} in total spend to unlock Tier 2
                (4.5% rebate rate). You are {formatPerfCurrency(750000)} away from
                this target.
              </p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
