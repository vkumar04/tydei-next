"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { DepreciationCalculator } from "../depreciation-calculator"
import type { DepreciationSchedule } from "@/lib/analysis/depreciation"

export interface ContractInputsTabProps {
  contractTotal: number
  contractLength: number
  discountRate: number
  taxRate: number
  annualGrowthRate: number
  rebatePercent: number
  onContractTotalChange: (value: number) => void
  onContractLengthChange: (value: number) => void
  onDiscountRateChange: (value: number) => void
  onTaxRateChange: (value: number) => void
  onAnnualGrowthRateChange: (value: number) => void
  onRebatePercentChange: (value: number) => void
  onScheduleChange: (schedule: DepreciationSchedule | null) => void
}

export function ContractInputsTab({
  contractTotal,
  contractLength,
  discountRate,
  taxRate,
  annualGrowthRate,
  rebatePercent,
  onContractTotalChange,
  onContractLengthChange,
  onDiscountRateChange,
  onTaxRateChange,
  onAnnualGrowthRateChange,
  onRebatePercentChange,
  onScheduleChange,
}: ContractInputsTabProps) {
  return (
    <div className="space-y-6">
      <DepreciationCalculator onScheduleChange={onScheduleChange} />

      {/* Financial Assumptions */}
      <Card>
        <CardHeader>
          <CardTitle>Financial Assumptions</CardTitle>
          <CardDescription>
            Configure parameters used across projections and financial
            analysis
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="contractTotal">Contract Total ($)</Label>
              <Input
                id="contractTotal"
                type="number"
                value={contractTotal}
                onChange={(e) =>
                  onContractTotalChange(Number(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="contractLength">
                Contract Length (years)
              </Label>
              <Input
                id="contractLength"
                type="number"
                min={1}
                max={30}
                value={contractLength}
                onChange={(e) =>
                  onContractLengthChange(Number(e.target.value) || 1)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="discountRate">Discount Rate (%)</Label>
              <Input
                id="discountRate"
                type="number"
                step={0.5}
                value={discountRate}
                onChange={(e) =>
                  onDiscountRateChange(Number(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="taxRate">Tax Rate (%)</Label>
              <Input
                id="taxRate"
                type="number"
                step={0.5}
                value={taxRate}
                onChange={(e) =>
                  onTaxRateChange(Number(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="annualGrowthRate">
                Annual Growth Rate (%)
              </Label>
              <Input
                id="annualGrowthRate"
                type="number"
                step={0.5}
                value={annualGrowthRate}
                onChange={(e) =>
                  onAnnualGrowthRateChange(Number(e.target.value) || 0)
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="rebatePercent">Rebate (%)</Label>
              <Input
                id="rebatePercent"
                type="number"
                step={0.5}
                value={rebatePercent}
                onChange={(e) =>
                  onRebatePercentChange(Number(e.target.value) || 0)
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
