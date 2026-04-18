"use client"

import { Bell, Clock, DollarSign, FileX, type LucideIcon } from "lucide-react"

import { Card, CardContent } from "@/components/ui/card"

interface AlertsSummaryCardsProps {
  offContractCount: number
  expiringCount: number
  rebatesDueCount: number
  totalUnresolved: number
}

interface SummaryCardProps {
  label: string
  value: number
  Icon: LucideIcon
  borderClass: string
  iconClass: string
}

function SummaryCard({
  label,
  value,
  Icon,
  borderClass,
  iconClass,
}: SummaryCardProps) {
  return (
    <Card className={`border-l-4 ${borderClass}`}>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-2xl font-bold">{value}</p>
          </div>
          <Icon className={`h-8 w-8 ${iconClass}`} />
        </div>
      </CardContent>
    </Card>
  )
}

export function AlertsSummaryCards({
  offContractCount,
  expiringCount,
  rebatesDueCount,
  totalUnresolved,
}: AlertsSummaryCardsProps) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <SummaryCard
        label="Off-Contract Alerts"
        value={offContractCount}
        Icon={FileX}
        borderClass="border-l-red-500"
        iconClass="text-red-500/50"
      />
      <SummaryCard
        label="Expiring Contracts"
        value={expiringCount}
        Icon={Clock}
        borderClass="border-l-yellow-500"
        iconClass="text-yellow-500/50"
      />
      <SummaryCard
        label="Rebates Due"
        value={rebatesDueCount}
        Icon={DollarSign}
        borderClass="border-l-green-500"
        iconClass="text-green-500/50"
      />
      <SummaryCard
        label="Total Unresolved"
        value={totalUnresolved}
        Icon={Bell}
        borderClass="border-l-blue-500"
        iconClass="text-blue-500/50"
      />
    </div>
  )
}
