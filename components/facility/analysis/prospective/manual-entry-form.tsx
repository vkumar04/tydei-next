"use client"

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Pencil, Calculator } from "lucide-react"

interface ManualEntryState {
  vendorName: string
  productCategory: string
  totalValue: number
  contractLength: number
  baseDiscount: number
  rebatePercent: number
  minimumSpend: number
  marketShare: number
}

export interface ManualEntryFormProps {
  manualEntry: ManualEntryState
  onManualEntryChange: (entry: ManualEntryState) => void
}

export function ManualEntryForm({
  manualEntry,
  onManualEntryChange,
}: ManualEntryFormProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Pencil className="h-5 w-5" />
          Manual Entry
        </CardTitle>
        <CardDescription>
          Enter contract details manually to analyze
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Vendor Name</Label>
            <Input
              value={manualEntry.vendorName}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  vendorName: e.target.value,
                })
              }
              placeholder="e.g., Arthrex"
            />
          </div>
          <div className="space-y-2">
            <Label>Product Category</Label>
            <Select
              value={manualEntry.productCategory}
              onValueChange={(v) =>
                onManualEntryChange({
                  ...manualEntry,
                  productCategory: v,
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Orthopedics">
                  Orthopedics
                </SelectItem>
                <SelectItem value="Cardiovascular">
                  Cardiovascular
                </SelectItem>
                <SelectItem value="General Surgery">
                  General Surgery
                </SelectItem>
                <SelectItem value="Spine">Spine</SelectItem>
                <SelectItem value="Trauma">Trauma</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Total Contract Value</Label>
            <Input
              type="number"
              value={manualEntry.totalValue}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  totalValue: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Contract Length (years)</Label>
            <Input
              type="number"
              value={manualEntry.contractLength}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  contractLength: Number(e.target.value),
                })
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Base Discount (%)</Label>
            <Input
              type="number"
              value={manualEntry.baseDiscount}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  baseDiscount: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Rebate (%)</Label>
            <Input
              type="number"
              value={manualEntry.rebatePercent}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  rebatePercent: Number(e.target.value),
                })
              }
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Minimum Spend Commitment</Label>
            <Input
              type="number"
              value={manualEntry.minimumSpend}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  minimumSpend: Number(e.target.value),
                })
              }
            />
          </div>
          <div className="space-y-2">
            <Label>Market Share Commitment (%)</Label>
            <Input
              type="number"
              value={manualEntry.marketShare}
              onChange={(e) =>
                onManualEntryChange({
                  ...manualEntry,
                  marketShare: Number(e.target.value),
                })
              }
            />
          </div>
        </div>

        <Button className="w-full">
          <Calculator className="h-4 w-4 mr-2" />
          Analyze Proposal
        </Button>
      </CardContent>
    </Card>
  )
}
