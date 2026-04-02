"use client"

import { Input } from "@/components/ui/input"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Label } from "@/components/ui/label"

export interface FinancialDetailsCardProps {
  contractTotal: string
  onContractTotalChange: (value: string) => void
}

export function FinancialDetailsCard({
  contractTotal,
  onContractTotalChange,
}: FinancialDetailsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Details</CardTitle>
        <CardDescription>Expected contract value</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          <Label htmlFor="contractTotal">
            Expected Contract Total
          </Label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              $
            </span>
            <Input
              id="contractTotal"
              type="number"
              value={contractTotal}
              onChange={(e) => onContractTotalChange(e.target.value)}
              className="pl-7"
              placeholder="0.00"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
