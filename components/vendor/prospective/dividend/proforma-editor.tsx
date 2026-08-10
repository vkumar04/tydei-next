"use client"

import { Card } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ChevronsUpDown } from "lucide-react"
import { formatCurrency } from "@/lib/formatting"
import {
  otherVariableTotal,
  fixedTotal,
  lineItemsToProforma,
  resolvePnL,
  type ProformaLineItems,
} from "@/lib/financial-analysis/proforma-pnl"
import { MoneyInput } from "./primitives"

/**
 * Collapsible full Steady State Proforma editor — every operating line is
 * editable so the analysis can run on the facility's actual statement instead
 * of the 1.2×-Medicare default.
 */
export function ProformaEditor({
  open,
  onOpenChange,
  lineItems,
  onChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  lineItems: ProformaLineItems
  onChange: (patch: Partial<ProformaLineItems>) => void
}) {
  // Canonical resolver, not a hand-rolled reducer — the NOI shown here must
  // be byte-identical to the engine's.
  const resolved = resolvePnL(lineItemsToProforma(lineItems))
  const noi = resolved.netOperatingIncome

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card>
        <CollapsibleTrigger className="flex w-full items-center justify-between p-6 text-left">
          <div>
            <div className="text-base font-semibold">
              Facility Proforma — Full P&amp;L
            </div>
            <div className="text-sm text-muted-foreground">
              Every line from the Steady State Proforma (defaults to the 1.2×
              Medicare example). Enter the facility&apos;s actual statement to
              drive the analysis.
            </div>
          </div>
          <ChevronsUpDown className="h-4 w-4 text-muted-foreground" />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Separator />
          <div className="space-y-6 p-6">
            {/* Revenue */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Revenue</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(
                    lineItems.standardBillingRevenue -
                      lineItems.contractualAdjustment,
                  )}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MoneyInput
                  label="Revenue — standard billing rate"
                  value={lineItems.standardBillingRevenue}
                  onChange={(v) => onChange({ standardBillingRevenue: v })}
                />
                <MoneyInput
                  label="Revenue — contractual adjustment"
                  value={lineItems.contractualAdjustment}
                  onChange={(v) => onChange({ contractualAdjustment: v })}
                  hint="Payer discount off gross charges (entered as a positive number)."
                />
              </div>
            </div>

            <Separator />

            {/* Variable expenses */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Variable Expenses</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(
                    lineItems.medicalSupplies + otherVariableTotal(lineItems),
                  )}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MoneyInput
                  label="Salary and benefits"
                  value={lineItems.salaryBenefits}
                  onChange={(v) => onChange({ salaryBenefits: v })}
                />
                <MoneyInput
                  label="Medical supplies and services"
                  value={lineItems.medicalSupplies}
                  onChange={(v) => onChange({ medicalSupplies: v })}
                  hint="The line a supply purchase moves directly."
                />
                <MoneyInput
                  label="Small equipment purchases"
                  value={lineItems.smallEquipment}
                  onChange={(v) => onChange({ smallEquipment: v })}
                />
                <MoneyInput
                  label="Office expenses"
                  value={lineItems.officeExpenses}
                  onChange={(v) => onChange({ officeExpenses: v })}
                />
                <MoneyInput
                  label="Legal"
                  value={lineItems.legal}
                  onChange={(v) => onChange({ legal: v })}
                />
                <MoneyInput
                  label="Computer services"
                  value={lineItems.computerServices}
                  onChange={(v) => onChange({ computerServices: v })}
                />
                <MoneyInput
                  label="Management fees"
                  value={lineItems.managementFees}
                  onChange={(v) => onChange({ managementFees: v })}
                />
                <MoneyInput
                  label="Billing and collection"
                  value={lineItems.billingCollection}
                  onChange={(v) => onChange({ billingCollection: v })}
                />
                <MoneyInput
                  label="Other outside services"
                  value={lineItems.otherOutsideServices}
                  onChange={(v) => onChange({ otherOutsideServices: v })}
                />
              </div>
            </div>

            <Separator />

            {/* Fixed expenses */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold">Fixed Expenses</span>
                <span className="text-sm font-semibold tabular-nums">
                  {formatCurrency(fixedTotal(lineItems))}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <MoneyInput
                  label="Insurance"
                  value={lineItems.insurance}
                  onChange={(v) => onChange({ insurance: v })}
                />
                <MoneyInput
                  label="Administrative expenses"
                  value={lineItems.administrative}
                  onChange={(v) => onChange({ administrative: v })}
                />
                <MoneyInput
                  label="Rent / TI amortization / utilities"
                  value={lineItems.rentTiUtilities}
                  onChange={(v) => onChange({ rentTiUtilities: v })}
                />
                <MoneyInput
                  label="Other facility expenses"
                  value={lineItems.otherFacility}
                  onChange={(v) => onChange({ otherFacility: v })}
                />
                <MoneyInput
                  label="Repairs & maintenance"
                  value={lineItems.repairsMaintenance}
                  onChange={(v) => onChange({ repairsMaintenance: v })}
                />
                <MoneyInput
                  label="Property tax"
                  value={lineItems.propTax}
                  onChange={(v) => onChange({ propTax: v })}
                />
                <MoneyInput
                  label="State taxes"
                  value={lineItems.stateTaxes}
                  onChange={(v) => onChange({ stateTaxes: v })}
                />
                <MoneyInput
                  label="Software maintenance"
                  value={lineItems.softwareMaintenance}
                  onChange={(v) => onChange({ softwareMaintenance: v })}
                />
                <MoneyInput
                  label="Equip rent / interest / other"
                  value={lineItems.equipRentInterestOther}
                  onChange={(v) => onChange({ equipRentInterestOther: v })}
                />
              </div>
            </div>

            <Separator />

            {/* Volume + NOI summary */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <MoneyInput
                label="Case volume"
                value={lineItems.caseVolume}
                onChange={(v) => onChange({ caseVolume: v })}
                prefix=""
              />
              <div className="flex flex-col justify-center rounded-md border border-border px-3 py-2">
                <span className="text-[11px] text-muted-foreground">
                  Net Operating Income
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(noi)}
                </span>
              </div>
              <div className="flex flex-col justify-center rounded-md border border-border px-3 py-2">
                <span className="text-[11px] text-muted-foreground">
                  NOI per case
                </span>
                <span className="text-lg font-semibold tabular-nums">
                  {formatCurrency(
                    lineItems.caseVolume > 0 ? noi / lineItems.caseVolume : 0,
                  )}
                </span>
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
