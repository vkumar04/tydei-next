"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { alertTypeIconConfig } from "./alert-config"
import { formatCurrency } from "@/lib/formatting"
import { formatDistanceToNow } from "date-fns"
import {
  Building2,
  Calendar,
  Clock,
  DollarSign,
  FileText,
  Package,
  TrendingUp,
  ExternalLink,
  CheckCircle,
  XCircle,
} from "lucide-react"
import Link from "next/link"
import type { Alert, Contract, Vendor, Facility } from "@prisma/client"

type AlertDetail = Alert & {
  contract?: Pick<
    Contract,
    "id" | "name" | "status" | "contractNumber" | "effectiveDate" | "expirationDate" | "totalValue"
  > | null
  vendor?: Pick<Vendor, "id" | "name"> | null
  facility?: Pick<Facility, "id" | "name"> | null
}

interface AlertDetailCardProps {
  alert: AlertDetail
  onResolve?: () => void
  onDismiss?: () => void
}

// Safe accessor for metadata fields
function meta(alert: AlertDetail, key: string): string | number | null {
  const m = alert.metadata as Record<string, unknown> | null
  if (!m || m[key] == null) return null
  return m[key] as string | number
}

function fmtCurrency(amount: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
  }).format(amount)
}

export function AlertDetailCard({ alert, onResolve, onDismiss }: AlertDetailCardProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]

  // Pull action link label based on alert type
  const actionLabel =
    alert.alertType === "off_contract"
      ? "View Purchase Order"
      : alert.alertType === "expiring_contract"
        ? "View Contract"
        : alert.alertType === "tier_threshold"
          ? "View Contract"
          : alert.alertType === "rebate_due"
            ? "View Rebate Details"
            : alert.alertType === "payment_due"
              ? "View Contract"
              : "View Details"

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        {/* Main Alert Card */}
        <Card>
          <CardHeader>
            <CardTitle>Alert Details</CardTitle>
            <CardDescription>{alert.description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {(alert.vendor?.name ?? meta(alert, "vendor_name")) && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Vendor</p>
                    <p className="font-medium">
                      {alert.vendor?.name ?? (meta(alert, "vendor_name") as string)}
                    </p>
                  </div>
                </div>
              )}
              {(alert.facility?.name ?? meta(alert, "facility_name")) && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Facility</p>
                    <p className="font-medium">
                      {alert.facility?.name ?? (meta(alert, "facility_name") as string)}
                    </p>
                  </div>
                </div>
              )}
              {meta(alert, "po_id") && (
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">PO Number</p>
                    <p className="font-medium">#{meta(alert, "po_id")}</p>
                  </div>
                </div>
              )}
              {(alert.contract?.name ?? meta(alert, "contract_name")) && (
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Contract</p>
                    <p className="font-medium">
                      {alert.contract?.name ?? (meta(alert, "contract_name") as string)}
                    </p>
                  </div>
                </div>
              )}
              {meta(alert, "total_amount") && (
                <div className="flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Total Amount</p>
                    <p className="font-medium">{fmtCurrency(meta(alert, "total_amount") as number)}</p>
                  </div>
                </div>
              )}
              {meta(alert, "amount") && (
                <div className="flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Amount</p>
                    <p className="font-medium">{fmtCurrency(meta(alert, "amount") as number)}</p>
                  </div>
                </div>
              )}
              {(alert.contract?.expirationDate ?? meta(alert, "expiration_date")) && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Expiration Date</p>
                    <p className="font-medium">
                      {alert.contract?.expirationDate
                        ? new Date(alert.contract.expirationDate).toLocaleDateString()
                        : (meta(alert, "expiration_date") as string)}
                    </p>
                  </div>
                </div>
              )}
              {meta(alert, "days_until_expiry") && (
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Days Until Expiry</p>
                    <p className="font-medium">{meta(alert, "days_until_expiry")} days</p>
                  </div>
                </div>
              )}
              {meta(alert, "period") && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Period</p>
                    <p className="font-medium">{meta(alert, "period") as string}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Tier Progress */}
            {alert.alertType === "tier_threshold" && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4" />
                    Tier Progress
                  </h3>
                  <div className="p-4 rounded-lg bg-muted/50">
                    <div className="flex justify-between text-sm mb-2">
                      <span>Current Spend</span>
                      <span className="font-medium">
                        {fmtCurrency((meta(alert, "current_spend") as number) ?? 0)}
                      </span>
                    </div>
                    <div className="h-3 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full bg-primary rounded-full transition-all"
                        style={{
                          width: `${(((meta(alert, "current_spend") as number) ?? 0) / ((meta(alert, "tier_threshold") as number) ?? 1)) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="flex justify-between text-sm mt-2">
                      <span className="text-muted-foreground">
                        Tier {meta(alert, "target_tier")} threshold
                      </span>
                      <span className="font-medium">
                        {fmtCurrency((meta(alert, "tier_threshold") as number) ?? 0)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-3">
                      Spend{" "}
                      <span className="font-medium text-foreground">
                        {fmtCurrency((meta(alert, "amount_needed") as number) ?? 0)}
                      </span>{" "}
                      more to reach Tier {meta(alert, "target_tier")} and earn{" "}
                      <span className="font-medium text-foreground">
                        {meta(alert, "tier_rebate") as string}
                      </span>{" "}
                      rebate.
                    </p>
                  </div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Actions Sidebar */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {alert.actionLink && (
              <Button className="w-full" asChild>
                <Link href={alert.actionLink}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  {actionLabel}
                </Link>
              </Button>
            )}
            {alert.status !== "resolved" && onResolve && (
              <Button variant="outline" className="w-full" onClick={onResolve}>
                <CheckCircle className="mr-2 h-4 w-4" />
                Mark as Resolved
              </Button>
            )}
            {onDismiss && (
              <Button variant="ghost" className="w-full" onClick={onDismiss}>
                <XCircle className="mr-2 h-4 w-4" />
                Dismiss Alert
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Recommendations */}
        <Card>
          <CardHeader>
            <CardTitle>Recommendations</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm">
              {alert.alertType === "off_contract" && (
                <>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>
                      Contact{" "}
                      {alert.vendor?.name ?? (meta(alert, "vendor_name") as string) ?? "the vendor"}{" "}
                      to add these items to your contract
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>
                      Review purchasing guidelines with{" "}
                      {alert.facility?.name ?? (meta(alert, "facility_name") as string) ?? "facility"}{" "}
                      staff
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Consider substituting with on-contract alternatives</span>
                  </li>
                </>
              )}
              {alert.alertType === "expiring_contract" && (
                <>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Begin renewal negotiations early</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Review current pricing and usage data</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Request competitive quotes from other vendors</span>
                  </li>
                </>
              )}
              {alert.alertType === "tier_threshold" && (
                <>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Consolidate purchases to reach tier threshold</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Review upcoming planned purchases</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Contact vendor about accelerating orders</span>
                  </li>
                </>
              )}
              {alert.alertType === "rebate_due" && (
                <>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>
                      Submit rebate claim to{" "}
                      {alert.vendor?.name ?? (meta(alert, "vendor_name") as string) ?? "the vendor"}
                    </span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Verify purchase data for accuracy</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Follow up if not received within 30 days</span>
                  </li>
                </>
              )}
              {alert.alertType === "payment_due" && (
                <>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Verify invoice details are correct</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Schedule payment to avoid late fees</span>
                  </li>
                  <li className="flex gap-2">
                    <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                    <span>Confirm equipment delivery was completed</span>
                  </li>
                </>
              )}
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
