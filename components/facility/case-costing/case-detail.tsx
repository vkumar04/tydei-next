"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { AISupplyMatch } from "@/components/facility/case-costing/ai-supply-match"
import type { CaseDetail } from "@/lib/actions/cases"

interface CaseDetailViewProps {
  caseData: CaseDetail
  contractPricing?: Array<{ vendorItemNo: string; description?: string; unitPrice: number }>
}

export function CaseDetailView({ caseData, contractPricing = [] }: CaseDetailViewProps) {
  const onContract = caseData.supplies.filter((s) => s.isOnContract)
  const offContract = caseData.supplies.filter((s) => !s.isOnContract)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">
            Case {caseData.caseNumber}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-2 text-sm sm:grid-cols-3">
          <div>
            <span className="text-muted-foreground">Surgeon:</span>{" "}
            {caseData.surgeonName ?? "N/A"}
          </div>
          <div>
            <span className="text-muted-foreground">Date:</span>{" "}
            {caseData.dateOfSurgery}
          </div>
          <div>
            <span className="text-muted-foreground">CPT:</span>{" "}
            {caseData.primaryCptCode ?? "N/A"}
          </div>
          <div>
            <span className="text-muted-foreground">Spend:</span>{" "}
            ${caseData.totalSpend.toLocaleString()}
          </div>
          <div>
            <span className="text-muted-foreground">Reimbursement:</span>{" "}
            ${caseData.totalReimbursement.toLocaleString()}
          </div>
          <div>
            <span className="text-muted-foreground">Margin:</span>{" "}
            <span className={caseData.margin >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
              ${caseData.margin.toLocaleString()}
            </span>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">
              Supplies ({caseData.supplies.length})
            </CardTitle>
            <div className="flex gap-2 text-xs">
              <Badge variant="default">{onContract.length} on-contract</Badge>
              <Badge variant="secondary">{offContract.length} off-contract</Badge>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Material</TableHead>
                <TableHead>Item #</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Extended</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>AI Match</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {caseData.supplies.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.materialName}</TableCell>
                  <TableCell className="text-muted-foreground">{s.vendorItemNo ?? "—"}</TableCell>
                  <TableCell className="text-right">${s.usedCost.toFixed(2)}</TableCell>
                  <TableCell className="text-right">{s.quantity}</TableCell>
                  <TableCell className="text-right">${s.extendedCost.toFixed(2)}</TableCell>
                  <TableCell>
                    <Badge variant={s.isOnContract ? "default" : "secondary"}>
                      {s.isOnContract ? "On-Contract" : "Off"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {!s.isOnContract && contractPricing.length > 0 && (
                      <AISupplyMatch
                        supplyName={s.materialName}
                        vendorItemNo={s.vendorItemNo ?? undefined}
                        contractPricing={contractPricing}
                        onMatch={() => {}}
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
