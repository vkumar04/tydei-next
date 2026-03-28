"use client"

import { Trash2 } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { TierInput } from "@/lib/validators/contract-terms"

interface ContractTierRowProps {
  tier: TierInput
  index: number
  onChange: (tier: TierInput) => void
  onRemove: () => void
}

const rebateTypes = [
  { value: "percent_of_spend", label: "% of Spend" },
  { value: "fixed_rebate", label: "Fixed Rebate" },
  { value: "fixed_rebate_per_unit", label: "Fixed / Unit" },
  { value: "per_procedure_rebate", label: "Per Procedure" },
] as const

export function ContractTierRow({
  tier,
  index,
  onChange,
  onRemove,
}: ContractTierRowProps) {
  return (
    <div className="flex flex-wrap items-end gap-2 rounded-md border p-3">
      <span className="flex h-9 items-center text-xs font-medium text-muted-foreground">
        Tier {index + 1}
      </span>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Spend Min</label>
        <Input
          type="number"
          className="w-28"
          value={tier.spendMin}
          onChange={(e) =>
            onChange({ ...tier, spendMin: Number(e.target.value) })
          }
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Spend Max</label>
        <Input
          type="number"
          className="w-28"
          value={tier.spendMax ?? ""}
          onChange={(e) =>
            onChange({
              ...tier,
              spendMax: e.target.value ? Number(e.target.value) : undefined,
            })
          }
        />
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Rebate Type</label>
        <Select
          value={tier.rebateType}
          onValueChange={(v) =>
            onChange({ ...tier, rebateType: v as TierInput["rebateType"] })
          }
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {rebateTypes.map((rt) => (
              <SelectItem key={rt.value} value={rt.value}>
                {rt.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1">
        <label className="text-xs text-muted-foreground">Rebate Value</label>
        <Input
          type="number"
          step="0.01"
          className="w-24"
          value={tier.rebateValue}
          onChange={(e) =>
            onChange({ ...tier, rebateValue: Number(e.target.value) })
          }
        />
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        onClick={onRemove}
        className="text-destructive"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  )
}
