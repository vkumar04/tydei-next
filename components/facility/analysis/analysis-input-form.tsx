"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

/**
 * Form state for the financial-analysis inputs panel.
 *
 * Values are stored in UI-friendly units:
 *   - percentages as whole numbers (8 = 8%)
 *   - dollar amounts as plain numbers
 * The orchestrator is responsible for converting to the decimal units
 * the pure engines consume (8 → 0.08).
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
}

export interface AnalysisInputFormProps {
  contracts: ContractPickOption[]
  contractsLoading: boolean
  value: AnalysisFormState
  onChange: (next: AnalysisFormState) => void
}

export function AnalysisInputForm({
  contracts,
  contractsLoading,
  value,
  onChange,
}: AnalysisInputFormProps) {
  const update = <K extends keyof AnalysisFormState>(
    key: K,
    next: AnalysisFormState[K],
  ) => onChange({ ...value, [key]: next })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Assumptions</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          <Label htmlFor="contract-pick">Contract</Label>
          <Select
            value={value.contractId ?? ""}
            onValueChange={(v) => update("contractId", v || null)}
            disabled={contractsLoading || contracts.length === 0}
          >
            <SelectTrigger id="contract-pick" className="mt-1">
              <SelectValue
                placeholder={
                  contractsLoading
                    ? "Loading contracts..."
                    : contracts.length === 0
                      ? "No active contracts available"
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
          label="Annual spend growth (%)"
          value={value.growthRatePerYear}
          step={0.5}
          onChange={(n) => update("growthRatePerYear", n)}
        />
        <NumberField
          id="marketDeclineRate"
          label="Market decline rate (%)"
          value={value.marketDeclineRate}
          step={0.5}
          onChange={(n) => update("marketDeclineRate", n)}
        />

        <div className="flex items-center justify-between rounded-md border p-3 md:col-span-2">
          <div>
            <Label htmlFor="payUpfront" className="text-sm font-medium">
              Pay upfront
            </Label>
            <p className="text-xs text-muted-foreground">
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
      </CardContent>
    </Card>
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
      <Label htmlFor={id}>{label}</Label>
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
        className="mt-1"
      />
    </div>
  )
}
