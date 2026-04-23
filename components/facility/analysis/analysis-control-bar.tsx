"use client"

import { SlidersHorizontal } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Separator } from "@/components/ui/separator"

/**
 * Form state for the financial-analysis inputs.
 *
 * Values are stored in UI-friendly units:
 *   - percentages as whole numbers (8 = 8%)
 *   - dollar amounts as plain numbers
 * The orchestrator converts these to the decimal units the pure engines
 * consume (8 → 0.08).
 */
export interface AnalysisFormState {
  contractId: string | null
  discountRate: number
  taxRate: number
  annualSpend: number
  rebateRate: number
  growthRatePerYear: number
  marketDeclineRate: number
  payUpfront: boolean
}

export interface ContractPickOption {
  id: string
  name: string
  vendorName: string
  contractType: string
}

export interface AnalysisControlBarProps {
  contracts: ContractPickOption[]
  contractsLoading: boolean
  value: AnalysisFormState
  onChange: (next: AnalysisFormState) => void
  /** When false, the capital-only "Pay upfront" switch is hidden. */
  showPayUpfront?: boolean
}

export function AnalysisControlBar({
  contracts,
  contractsLoading,
  value,
  onChange,
  showPayUpfront = false,
}: AnalysisControlBarProps) {
  const update = <K extends keyof AnalysisFormState>(
    key: K,
    next: AnalysisFormState[K],
  ) => onChange({ ...value, [key]: next })

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 shadow-xs">
      <div className="flex min-w-[280px] flex-1 items-center gap-2">
        <Label
          htmlFor="contract-pick"
          className="text-xs uppercase tracking-wider text-muted-foreground"
        >
          Contract
        </Label>
        <Select
          value={value.contractId ?? ""}
          onValueChange={(v) => update("contractId", v || null)}
          disabled={contractsLoading || contracts.length === 0}
        >
          <SelectTrigger id="contract-pick" className="border-0 shadow-none focus-visible:ring-0">
            <SelectValue
              placeholder={
                contractsLoading
                  ? "Loading contracts…"
                  : contracts.length === 0
                    ? "No active contracts"
                    : "Select a contract"
              }
            />
          </SelectTrigger>
          <SelectContent>
            {contracts.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name} — {c.vendorName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator orientation="vertical" className="h-6" />

      <div className="flex items-center gap-6">
        <InlineStat label="Discount" suffix="%" value={value.discountRate} />
        <InlineStat label="Rebate" suffix="%" value={value.rebateRate} />
        <InlineStat
          label="Spend"
          prefix="$"
          value={value.annualSpend}
          compact
        />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="ml-auto gap-2">
            <SlidersHorizontal className="h-4 w-4" />
            Assumptions
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-96 space-y-4">
          <div className="space-y-1">
            <p className="text-sm font-semibold">Assumptions</p>
            <p className="text-xs text-muted-foreground">
              Percentages as whole numbers (8 = 8%).
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="discountRate"
              label="Discount rate (%)"
              value={value.discountRate}
              step={0.25}
              onChange={(n) => update("discountRate", n)}
            />
            <NumberField
              id="taxRate"
              label="Tax rate (%)"
              value={value.taxRate}
              step={1}
              onChange={(n) => update("taxRate", n)}
            />
            <NumberField
              id="annualSpend"
              label="Annual spend ($)"
              value={value.annualSpend}
              step={1000}
              onChange={(n) => update("annualSpend", n)}
            />
            <NumberField
              id="rebateRate"
              label="Rebate rate (%)"
              value={value.rebateRate}
              step={0.25}
              onChange={(n) => update("rebateRate", n)}
            />
            <NumberField
              id="growthRatePerYear"
              label="Spend growth (%)"
              value={value.growthRatePerYear}
              step={0.5}
              onChange={(n) => update("growthRatePerYear", n)}
            />
            <NumberField
              id="marketDeclineRate"
              label="Market decline (%)"
              value={value.marketDeclineRate}
              step={0.5}
              onChange={(n) => update("marketDeclineRate", n)}
            />
          </div>
          {showPayUpfront && (
            <div className="flex items-start justify-between gap-3 rounded-md border p-3">
              <div>
                <Label htmlFor="payUpfront" className="text-sm font-medium">
                  Pay upfront
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  When on, the full capital cost is booked at t=0. When off, it
                  is amortized linearly across the contract term.
                </p>
              </div>
              <Switch
                id="payUpfront"
                checked={value.payUpfront}
                onCheckedChange={(c) => update("payUpfront", c)}
              />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  )
}

interface InlineStatProps {
  label: string
  value: number
  prefix?: string
  suffix?: string
  compact?: boolean
}

function InlineStat({ label, value, prefix, suffix, compact }: InlineStatProps) {
  const display = compact && value >= 1000
    ? `${(value / 1000).toFixed(value >= 10_000 ? 0 : 1)}K`
    : value.toLocaleString()
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="text-sm font-semibold tabular-nums">
        {prefix}
        {display}
        {suffix}
      </span>
    </div>
  )
}

interface NumberFieldProps {
  id: string
  label: string
  value: number
  step: number
  onChange: (next: number) => void
}

function NumberField({ id, label, value, step, onChange }: NumberFieldProps) {
  return (
    <div>
      <Label htmlFor={id} className="text-xs">
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        step={step}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const parsed = Number(e.target.value)
          onChange(Number.isFinite(parsed) ? parsed : 0)
        }}
        className="mt-1 h-9"
      />
    </div>
  )
}
