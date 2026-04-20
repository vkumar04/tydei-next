"use client"

/**
 * Charles W1.T — single contract-level capital entry card.
 *
 * Replaces the per-term "Section A — Capital Terms" block that previously
 * lived on every ContractTerm. A tie-in contract now has ONE capital
 * asset (cost, interest, term, down payment, cadence, amortization shape)
 * whose balance is paid down by rebates earned across ALL rebate terms
 * on the contract.
 */
import { AlertTriangle, HelpCircle, Sparkles } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Field } from "@/components/shared/forms/field"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { TieInAmortizationPreview } from "./tie-in-amortization-preview"
import {
  toDisplayInterestRate,
  fromDisplayInterestRate,
} from "@/lib/contracts/interest-rate-normalize"

export interface ContractCapital {
  capitalCost: number | null
  interestRate: number | null
  termMonths: number | null
  downPayment: number | null
  paymentCadence: "monthly" | "quarterly" | "annual" | null
  amortizationShape: "symmetrical" | "custom"
  customAmortizationRows?:
    | { periodNumber: number; amortizationDue: number }[]
    | undefined
}

interface ContractCapitalEntryProps {
  capital: ContractCapital
  onChange: (patch: Partial<ContractCapital>) => void
  effectiveDate?: string | null
}

export function ContractCapitalEntry({
  capital,
  onChange,
  effectiveDate,
}: ContractCapitalEntryProps) {
  return (
    <div className="space-y-5 rounded-md border p-4">
      {/* Top-of-block explainer card (preserved from W1.G). */}
      <div className="flex gap-3 rounded-md border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <div className="space-y-1">
          <p className="font-semibold">Tie-In Capital Contract</p>
          <p className="leading-snug">
            Tie-in contracts pair capital equipment (a robot, imaging
            system, etc.) with a consumable/disposable contract whose
            spend pays down the capital balance via rebates. Capital is
            entered once at the contract level — every rebate term below
            pays down the same balance.
          </p>
        </div>
      </div>

      {/* Empty-state nudge when no capital is entered yet. */}
      {capital.capitalCost == null &&
        capital.interestRate == null &&
        capital.termMonths == null && (
          <div className="rounded-md border border-dashed bg-muted/40 p-3 text-xs">
            <p className="font-medium">New to tie-in contracts?</p>
            <p className="mt-1 text-muted-foreground">
              Fill in capital cost + interest + term below, then add the
              rebate term(s) that drive the paydown.
            </p>
          </div>
        )}

      {/* Section 1 — Capital Terms */}
      <div className="space-y-3">
        <div>
          <h4 className="text-sm font-semibold">1. Capital Terms</h4>
          <p className="text-xs text-muted-foreground">
            What was purchased and how it&apos;s being paid for.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Capital Cost ($)">
            <Input
              type="number"
              value={capital.capitalCost ?? ""}
              onChange={(e) =>
                onChange({
                  capitalCost:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              e.g. $1,250,000 for a surgical robot
            </p>
          </Field>
          <Field label="Interest Rate (%)">
            <Input
              type="number"
              step="0.0001"
              // Storage is fraction (0.04 = 4%); input shows whole percent.
              value={
                capital.interestRate == null
                  ? ""
                  : toDisplayInterestRate(capital.interestRate)
              }
              onChange={(e) =>
                onChange({
                  interestRate:
                    e.target.value === ""
                      ? null
                      : fromDisplayInterestRate(Number(e.target.value)),
                })
              }
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              e.g. 4% APR — typical financed range
            </p>
            {capital.interestRate != null && capital.interestRate > 0.15 && (
              <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                <span>
                  That&apos;s higher than typical medical capital financing
                  (3-8%). Double-check.
                </span>
              </p>
            )}
          </Field>
          <Field label="Term (months)">
            <Input
              type="number"
              value={capital.termMonths ?? ""}
              onChange={(e) =>
                onChange({
                  termMonths:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              e.g. 60 (5 years)
            </p>
            {capital.termMonths != null &&
              capital.termMonths > 0 &&
              capital.termMonths < 12 && (
                <p className="mt-1 inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Under 12 months is unusual for financed capital.</span>
                </p>
              )}
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label className="inline-flex items-center gap-1">
              Down Payment ($)
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center">
                      <HelpCircle
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label="Down payment help"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] p-3 text-xs">
                    <p>
                      Initial payment at contract signing. Reduces the
                      starting balance used to compute the amortization
                      schedule.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Input
              type="number"
              value={capital.downPayment ?? ""}
              onChange={(e) =>
                onChange({
                  downPayment:
                    e.target.value === "" ? null : Number(e.target.value),
                })
              }
            />
            <p className="text-[11px] text-muted-foreground">
              e.g. 10-20% of capital is standard when financed; $0 for
              placement deals
            </p>
            {capital.downPayment != null &&
              capital.capitalCost != null &&
              capital.downPayment > capital.capitalCost && (
                <p className="inline-flex items-start gap-1 text-[11px] text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                  <span>Down payment exceeds capital cost.</span>
                </p>
              )}
          </div>
          <div className="space-y-2">
            <Label className="inline-flex items-center gap-1">
              Payment Cadence
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="inline-flex cursor-help items-center">
                      <HelpCircle
                        className="h-3.5 w-3.5 text-muted-foreground"
                        aria-label="Payment cadence help"
                      />
                    </span>
                  </TooltipTrigger>
                  <TooltipContent className="max-w-[320px] p-3 text-xs">
                    <p>
                      How often an amortization payment is scheduled.
                      Monthly is standard for financed capital; quarterly
                      is common for usage-linked paydowns.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </Label>
            <Select
              value={capital.paymentCadence ?? "monthly"}
              onValueChange={(v) =>
                onChange({
                  paymentCadence: v as ContractCapital["paymentCadence"],
                })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="monthly">Monthly</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Monthly for most financed capital; Quarterly for usage-linked
              paydowns
            </p>
          </div>
        </div>
      </div>

      {/* Section 2 — Amortization Schedule shape + preview */}
      <div className="space-y-3 border-t pt-4">
        <div>
          <h4 className="text-sm font-semibold">2. Amortization Schedule</h4>
          <p className="text-xs text-muted-foreground">
            How the capital balance is paid down period by period. Preview
            updates as you edit above.
          </p>
        </div>
        <div className="space-y-2">
          <Label className="inline-flex items-center gap-1">
            Payment Schedule Shape
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <HelpCircle className="h-3.5 w-3.5 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  Symmetrical means equal payments every period (standard
                  PMT amortization). Custom lets you enter a different
                  amount for each period.
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </Label>
          <RadioGroup
            className="grid grid-cols-1 gap-2 sm:grid-cols-2"
            value={capital.amortizationShape ?? "symmetrical"}
            onValueChange={(v) =>
              onChange({
                amortizationShape:
                  v === "custom" ? "custom" : "symmetrical",
                // Clear seeded customRows when returning to symmetrical
                // so stale edits don't persist on save.
                customAmortizationRows:
                  v === "custom" ? capital.customAmortizationRows : undefined,
              })
            }
          >
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
              <RadioGroupItem value="symmetrical" />
              <span>
                <span className="font-medium">Symmetrical</span>
                <span className="block text-xs text-muted-foreground">
                  Equal payments every period. Auto-computed from capital
                  cost + interest + term.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm">
              <RadioGroupItem value="custom" />
              <span>
                <span className="font-medium">Custom</span>
                <span className="block text-xs text-muted-foreground">
                  Enter a different amount for each period.
                </span>
              </span>
            </label>
          </RadioGroup>
        </div>
        <TieInAmortizationPreview
          capitalCost={capital.capitalCost}
          downPayment={capital.downPayment}
          interestRate={capital.interestRate}
          termMonths={capital.termMonths}
          paymentCadence={capital.paymentCadence ?? undefined}
          effectiveStart={effectiveDate ?? ""}
          amortizationShape={capital.amortizationShape ?? "symmetrical"}
          customRows={capital.customAmortizationRows}
          onCustomRowsChange={(rows) =>
            onChange({ customAmortizationRows: rows })
          }
        />
      </div>
    </div>
  )
}
