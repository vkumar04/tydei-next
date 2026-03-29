"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { alertTypeIconConfig, alertSeverityBadgeConfig } from "./alert-config"
import { formatDate, formatCurrency } from "@/lib/formatting"
import { formatDistanceToNow } from "date-fns"
import { Building2, Calendar, DollarSign, FileText } from "lucide-react"
import type { Alert, Contract, Vendor, Facility } from "@prisma/client"

type AlertDetail = Alert & {
  contract?: Pick<
    Contract,
    "id" | "name" | "status" | "contractNumber" | "effectiveDate" | "expirationDate" | "totalValue"
  > | null
  vendor?: Pick<Vendor, "id" | "name"> | null
  facility?: Pick<Facility, "id" | "name"> | null
}

const alertColorBg: Record<string, string> = {
  off_contract: "text-red-500 bg-red-50 dark:bg-red-950",
  expiring_contract: "text-amber-500 bg-amber-50 dark:bg-amber-950",
  tier_threshold: "text-blue-500 bg-blue-50 dark:bg-blue-950",
  rebate_due: "text-emerald-500 bg-emerald-50 dark:bg-emerald-950",
  payment_due: "text-purple-500 bg-purple-50 dark:bg-purple-950",
  pricing_error: "text-red-500 bg-red-50 dark:bg-red-950",
  compliance: "text-amber-500 bg-amber-50 dark:bg-amber-950",
}

const statusColors: Record<string, string> = {
  new_alert: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
  read: "bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-300",
  resolved: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  dismissed: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
}

interface AlertDetailCardProps {
  alert: AlertDetail
}

export function AlertDetailCard({ alert }: AlertDetailCardProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon
  const colorClasses = alertColorBg[alert.alertType] ?? "text-muted-foreground bg-muted"

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main content column */}
      <div className="lg:col-span-2 space-y-6">
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              {Icon && (
                <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${colorClasses}`}>
                  <Icon className="h-5 w-5" />
                </div>
              )}
              <div className="flex-1">
                <CardTitle className="text-lg">{alert.title}</CardTitle>
                <CardDescription>
                  {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true })}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                {severityConfig && (
                  <Badge variant={severityConfig.variant} className={severityConfig.className}>
                    {severityConfig.label} priority
                  </Badge>
                )}
                <Badge className={statusColors[alert.status] ?? ""}>
                  {alert.status.replace("_", " ")}
                </Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Description */}
            {alert.description && (
              <>
                <p className="text-sm text-muted-foreground">{alert.description}</p>
                <Separator />
              </>
            )}

            {/* Metadata grid */}
            <div className="grid gap-4 sm:grid-cols-2">
              {alert.vendor && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Vendor</p>
                    <p className="font-medium">{alert.vendor.name}</p>
                  </div>
                </div>
              )}
              {alert.facility && (
                <div className="flex items-center gap-3">
                  <Building2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Facility</p>
                    <p className="font-medium">{alert.facility.name}</p>
                  </div>
                </div>
              )}
              {alert.contract && (
                <div className="flex items-center gap-3">
                  <FileText className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Contract</p>
                    <p className="font-medium">{alert.contract.name}</p>
                  </div>
                </div>
              )}
              {alert.contract?.totalValue && (
                <div className="flex items-center gap-3">
                  <DollarSign className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Contract Value</p>
                    <p className="font-medium">{formatCurrency(Number(alert.contract.totalValue))}</p>
                  </div>
                </div>
              )}
              {alert.contract?.expirationDate && (
                <div className="flex items-center gap-3">
                  <Calendar className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="text-sm text-muted-foreground">Expiration Date</p>
                    <p className="font-medium">{formatDate(alert.contract.expirationDate)}</p>
                  </div>
                </div>
              )}
              <div className="flex items-center gap-3">
                <Calendar className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm text-muted-foreground">Created</p>
                  <p className="font-medium">{formatDate(alert.createdAt)}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Sidebar info card */}
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Alert Info</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type</span>
              <Badge variant="outline">{typeConfig?.label ?? alert.alertType}</Badge>
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Severity</span>
              {severityConfig && (
                <Badge variant={severityConfig.variant} className={severityConfig.className}>
                  {severityConfig.label}
                </Badge>
              )}
            </div>
            <Separator />
            <div className="flex justify-between">
              <span className="text-muted-foreground">Status</span>
              <Badge className={statusColors[alert.status] ?? ""}>
                {alert.status.replace("_", " ")}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
