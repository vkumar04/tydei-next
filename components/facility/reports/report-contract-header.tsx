"use client"

import { Card } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"

/**
 * Header band for the per-contract "Contract Performance Details"
 * drill-down on the facility Reports page. Presentational only — the
 * parent (`ReportsPerTypeTab`) maps the selected contract's fields onto
 * these props.
 */

interface ReportContractHeaderProps {
  facilityName: string
  contractId: string
  contractType: string
  effectiveDate: string
  expirationDate: string
  totalValue: number
  margin: number
  dateFrom: string
  dateTo: string
}

// ContractType enum → human label.
const CONTRACT_TYPE_LABELS: Record<string, string> = {
  usage: "Usage Contract",
  capital: "Capital",
  service: "Service",
  tie_in: "Tie-In Contract",
  grouped: "Grouped",
  pricing_only: "Pricing Only",
}

function contractTypeLabel(contractType: string): string {
  return CONTRACT_TYPE_LABELS[contractType] ?? contractType
}

/** MM/DD/YYYY, pinned to UTC so @db.Date columns don't shift a day. */
function formatUsDate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return "—"
  return new Intl.DateTimeFormat("en-US", {
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(d)
}

interface FieldProps {
  label: string
  value: string
}

function Field({ label, value }: FieldProps) {
  return (
    <div className="space-y-1">
      <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

export function ReportContractHeader({
  facilityName,
  contractId,
  contractType,
  effectiveDate,
  expirationDate,
  totalValue,
  margin,
  dateFrom,
  dateTo,
}: ReportContractHeaderProps) {
  return (
    <Card className="mb-6 overflow-hidden p-0">
      <div className="bg-primary px-6 py-4 text-primary-foreground">
        <h3 className="text-lg font-semibold">Contract Performance Details</h3>
        <p className="text-sm text-primary-foreground/80">
          From {dateFrom} To {dateTo}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-6 py-5 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Facility" value={facilityName} />
        <Field label="Contract ID" value={contractId} />
        <Field label="Contract Type" value={contractTypeLabel(contractType)} />
        <Field
          label="Effective Date"
          value={`${formatUsDate(effectiveDate)} to ${formatUsDate(expirationDate)}`}
        />
        <Field label="Contract Total" value={formatCurrency(totalValue)} />
        <Field label="Contract Margin" value={formatCurrency(margin)} />
      </div>
    </Card>
  )
}
