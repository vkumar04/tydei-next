"use client"

import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatPerfCurrency, type ContractPerf } from "./performance-types"

export interface PerformanceContractsTabProps {
  contracts: ContractPerf[]
}

export function PerformanceContractsTab({
  contracts,
}: PerformanceContractsTabProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Contract Performance Details</CardTitle>
        <CardDescription>Individual contract compliance and metrics</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Contract</TableHead>
              <TableHead>Facility</TableHead>
              <TableHead className="text-right">Target</TableHead>
              <TableHead className="text-right">Actual</TableHead>
              <TableHead className="text-right">Compliance</TableHead>
              <TableHead className="text-right">Rebate Paid</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((contract) => (
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
                <TableCell className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <Progress value={Math.min(contract.compliance, 100)} className="w-16 h-2" />
                    <span className="text-sm">{contract.compliance}%</span>
                  </div>
                </TableCell>
                <TableCell className="text-right text-emerald-600 dark:text-emerald-400">
                  {formatPerfCurrency(contract.rebatePaid)}
                </TableCell>
                <TableCell>
                  <Badge
                    variant={
                      contract.status === "exceeding"
                        ? "default"
                        : contract.status === "on-track"
                          ? "secondary"
                          : "destructive"
                    }
                  >
                    {contract.status === "exceeding" && <ArrowUpRight className="h-3 w-3 mr-1" />}
                    {contract.status === "at-risk" && <AlertTriangle className="h-3 w-3 mr-1" />}
                    {contract.status === "on-track" && <CheckCircle2 className="h-3 w-3 mr-1" />}
                    {contract.status}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
