"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table"
import { alertTypeIconConfig, alertSeverityBadgeConfig } from "./alert-config"
import { formatDate, formatCurrency } from "@/lib/formatting"
import type { Alert, Contract, Vendor, Facility } from "@prisma/client"

type AlertDetail = Alert & {
  contract?: Pick<Contract, "id" | "name" | "status" | "contractNumber" | "effectiveDate" | "expirationDate" | "totalValue"> | null
  vendor?: Pick<Vendor, "id" | "name"> | null
  facility?: Pick<Facility, "id" | "name"> | null
}

interface AlertDetailCardProps {
  alert: AlertDetail
}

export function AlertDetailCard({ alert }: AlertDetailCardProps) {
  const typeConfig = alertTypeIconConfig[alert.alertType]
  const severityConfig = alertSeverityBadgeConfig[alert.severity]
  const Icon = typeConfig?.icon

  return (
    <Card>
      <CardHeader className="flex-row items-center gap-3 space-y-0">
        {Icon && <Icon className={`size-6 ${typeConfig.color}`} />}
        <div className="flex-1">
          <CardTitle className="text-lg">{alert.title}</CardTitle>
          {alert.description && (
            <p className="mt-1 text-sm text-muted-foreground">{alert.description}</p>
          )}
        </div>
        {severityConfig && (
          <Badge variant={severityConfig.variant} className={severityConfig.className}>
            {severityConfig.label}
          </Badge>
        )}
      </CardHeader>
      <CardContent>
        <Table>
          <TableBody>
            <TableRow>
              <TableCell className="font-medium">Type</TableCell>
              <TableCell>{typeConfig?.label ?? alert.alertType}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Status</TableCell>
              <TableCell className="capitalize">{alert.status.replace("_", " ")}</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-medium">Created</TableCell>
              <TableCell>{formatDate(alert.createdAt)}</TableCell>
            </TableRow>
            {alert.vendor && (
              <TableRow>
                <TableCell className="font-medium">Vendor</TableCell>
                <TableCell>{alert.vendor.name}</TableCell>
              </TableRow>
            )}
            {alert.contract && (
              <>
                <TableRow>
                  <TableCell className="font-medium">Contract</TableCell>
                  <TableCell>{alert.contract.name}</TableCell>
                </TableRow>
                {alert.contract.totalValue && (
                  <TableRow>
                    <TableCell className="font-medium">Contract Value</TableCell>
                    <TableCell>{formatCurrency(Number(alert.contract.totalValue))}</TableCell>
                  </TableRow>
                )}
              </>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}
