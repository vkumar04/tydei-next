/**
 * Charles 2026-04-25 (audit follow-up): the columns vendor-mirror
 * Phase 2 added to PendingContract (contractNumber, annualValue,
 * autoRenewal, terminationNoticeDays, capital tie-in fields)
 * needed UI inputs in the vendor submission form. Without this card
 * vendor submissions silently dropped these values even though the
 * server-side validator + persistence layer accept them.
 *
 * Capital tie-in fields render only when the contractType is
 * `capital` or `tie_in` — they're meaningless on usage / service /
 * pricing-only contracts.
 */
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"

export function VendorPhase2FieldsCard(props: {
  contractNumber: string
  onContractNumberChange: (v: string) => void
  annualValue: string
  onAnnualValueChange: (v: string) => void
  autoRenewal: boolean
  onAutoRenewalChange: (v: boolean) => void
  terminationNoticeDays: string
  onTerminationNoticeDaysChange: (v: string) => void
  showCapital: boolean
  capitalCost: string
  onCapitalCostChange: (v: string) => void
  interestRate: string
  onInterestRateChange: (v: string) => void
  termMonths: string
  onTermMonthsChange: (v: string) => void
  downPayment: string
  onDownPaymentChange: (v: string) => void
  paymentCadence: "monthly" | "quarterly" | "annual"
  onPaymentCadenceChange: (v: "monthly" | "quarterly" | "annual") => void
  amortizationShape: "symmetrical" | "custom"
  onAmortizationShapeChange: (v: "symmetrical" | "custom") => void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Details</CardTitle>
        <CardDescription>
          Reference number, annual value, renewal terms
          {props.showCapital ? ", and capital amortization" : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="vc-contract-number">Contract Number</Label>
            <Input
              id="vc-contract-number"
              value={props.contractNumber}
              onChange={(e) => props.onContractNumberChange(e.target.value)}
              placeholder="e.g. STK-2026-001"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="vc-annual-value">Annual Value</Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
              <Input
                id="vc-annual-value"
                type="number"
                step="0.01"
                value={props.annualValue}
                onChange={(e) => props.onAnnualValueChange(e.target.value)}
                placeholder="0"
                className="pl-7"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="vc-termination-notice">Termination Notice (days)</Label>
            <Input
              id="vc-termination-notice"
              type="number"
              min="0"
              value={props.terminationNoticeDays}
              onChange={(e) => props.onTerminationNoticeDaysChange(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-between">
            <Label htmlFor="vc-auto-renew">Auto-Renewal</Label>
            <Switch
              id="vc-auto-renew"
              checked={props.autoRenewal}
              onCheckedChange={props.onAutoRenewalChange}
            />
          </div>
        </div>

        {props.showCapital && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div>
              <p className="text-sm font-medium">Capital amortization</p>
              <p className="text-xs text-muted-foreground">
                Required for capital + tie-in contracts so the facility
                can render the amortization schedule on approve.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="vc-capital-cost">Capital Cost</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="vc-capital-cost"
                    type="number"
                    step="0.01"
                    value={props.capitalCost}
                    onChange={(e) => props.onCapitalCostChange(e.target.value)}
                    className="pl-7"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vc-interest-rate">Interest Rate (%)</Label>
                <div className="relative">
                  <Input
                    id="vc-interest-rate"
                    type="number"
                    step="0.01"
                    value={props.interestRate}
                    onChange={(e) => props.onInterestRateChange(e.target.value)}
                    placeholder="0"
                    className="pr-8"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground">%</span>
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vc-term-months">Term (months)</Label>
                <Input
                  id="vc-term-months"
                  type="number"
                  min="0"
                  value={props.termMonths}
                  onChange={(e) => props.onTermMonthsChange(e.target.value)}
                  placeholder="60"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vc-down-payment">Down Payment</Label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                  <Input
                    id="vc-down-payment"
                    type="number"
                    step="0.01"
                    value={props.downPayment}
                    onChange={(e) => props.onDownPaymentChange(e.target.value)}
                    className="pl-7"
                    placeholder="0"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vc-payment-cadence">Payment Cadence</Label>
                <Select
                  value={props.paymentCadence}
                  onValueChange={(v) =>
                    props.onPaymentCadenceChange(v as "monthly" | "quarterly" | "annual")
                  }
                >
                  <SelectTrigger id="vc-payment-cadence">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="quarterly">Quarterly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="vc-amortization-shape">Amortization</Label>
                <Select
                  value={props.amortizationShape}
                  onValueChange={(v) =>
                    props.onAmortizationShapeChange(v as "symmetrical" | "custom")
                  }
                >
                  <SelectTrigger id="vc-amortization-shape">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="symmetrical">Symmetrical (PMT)</SelectItem>
                    <SelectItem value="custom">Custom rows</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
