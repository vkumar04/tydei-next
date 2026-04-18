"use client"

import {
  Building2,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  type LucideIcon,
} from "lucide-react"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatCurrency } from "@/lib/formatting"

interface AlertDetailMetadataProps {
  metadata: Record<string, unknown>
  vendorName: string | null
  facilityName: string | null
  contractName: string | null
  contractExpirationDate: Date | null
}

interface Field {
  key: string
  label: string
  value: string
  Icon: LucideIcon
}

function readString(
  metadata: Record<string, unknown>,
  key: string,
): string | null {
  const v = metadata[key]
  if (typeof v === "string" && v.length > 0) return v
  if (typeof v === "number" && Number.isFinite(v)) return String(v)
  return null
}

function readNumber(
  metadata: Record<string, unknown>,
  key: string,
): number | null {
  const v = metadata[key]
  return typeof v === "number" && Number.isFinite(v) ? v : null
}

function formatDate(value: string | Date | null): string | null {
  if (!value) return null
  const d = typeof value === "string" ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString()
}

export function AlertDetailMetadata({
  metadata,
  vendorName,
  facilityName,
  contractName,
  contractExpirationDate,
}: AlertDetailMetadataProps) {
  const fields: Field[] = []

  const vendor = vendorName ?? readString(metadata, "vendor_name")
  if (vendor) {
    fields.push({ key: "vendor", label: "Vendor", value: vendor, Icon: Building2 })
  }

  if (facilityName) {
    fields.push({
      key: "facility",
      label: "Facility",
      value: facilityName,
      Icon: Building2,
    })
  }

  const poId = readString(metadata, "po_id")
  if (poId) {
    fields.push({
      key: "po",
      label: "PO Number",
      value: `#${poId}`,
      Icon: FileText,
    })
  }

  const contract = contractName ?? readString(metadata, "contract_name")
  if (contract) {
    fields.push({
      key: "contract",
      label: "Contract",
      value: contract,
      Icon: FileText,
    })
  }

  const totalAmount = readNumber(metadata, "total_amount")
  if (totalAmount !== null) {
    fields.push({
      key: "total_amount",
      label: "Total Amount",
      value: formatCurrency(totalAmount),
      Icon: DollarSign,
    })
  }

  const amount = readNumber(metadata, "amount")
  if (amount !== null) {
    fields.push({
      key: "amount",
      label: "Amount",
      value: formatCurrency(amount),
      Icon: DollarSign,
    })
  }

  const annualValue = readNumber(metadata, "annual_value")
  if (annualValue !== null) {
    fields.push({
      key: "annual_value",
      label: "Annual Value",
      value: formatCurrency(annualValue),
      Icon: DollarSign,
    })
  }

  const itemCount = readNumber(metadata, "item_count")
  if (itemCount !== null) {
    fields.push({
      key: "item_count",
      label: "Items",
      value: String(itemCount),
      Icon: FileText,
    })
  }

  const expirationDate =
    formatDate(contractExpirationDate) ??
    formatDate(readString(metadata, "expiration_date"))
  if (expirationDate) {
    fields.push({
      key: "expiration_date",
      label: "Expiration Date",
      value: expirationDate,
      Icon: Calendar,
    })
  }

  const dueDate = formatDate(readString(metadata, "due_date"))
  if (dueDate) {
    fields.push({
      key: "due_date",
      label: "Due Date",
      value: dueDate,
      Icon: Calendar,
    })
  }

  const daysUntilExpiry = readNumber(metadata, "days_until_expiry")
  if (daysUntilExpiry !== null) {
    fields.push({
      key: "days_until_expiry",
      label: "Days Until Expiry",
      value: `${daysUntilExpiry} days`,
      Icon: Clock,
    })
  }

  const period = readString(metadata, "period")
  if (period) {
    fields.push({
      key: "period",
      label: "Period",
      value: period,
      Icon: Calendar,
    })
  }

  if (fields.length === 0) {
    return null
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Details</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map(({ key, label, value, Icon }) => (
            <div key={key} className="flex items-center gap-3">
              <Icon className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-medium">{value}</p>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
