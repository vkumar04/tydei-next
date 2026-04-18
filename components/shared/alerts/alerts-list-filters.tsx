"use client"

import { Badge } from "@/components/ui/badge"
import { TabsList, TabsTrigger } from "@/components/ui/tabs"

export type AlertsTabValue =
  | "all"
  | "unread"
  | "off_contract"
  | "expiring"
  | "rebates"

interface AlertsListFiltersProps {
  unreadCount: number
}

const TABS: { value: AlertsTabValue; label: string }[] = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "off_contract", label: "Off-Contract" },
  { value: "expiring", label: "Expiring" },
  { value: "rebates", label: "Rebates" },
]

export function AlertsListFilters({ unreadCount }: AlertsListFiltersProps) {
  return (
    <TabsList>
      {TABS.map((tab) => (
        <TabsTrigger key={tab.value} value={tab.value}>
          {tab.label}
          {tab.value === "unread" && unreadCount > 0 ? (
            <Badge variant="secondary" className="ml-1">
              {unreadCount}
            </Badge>
          ) : null}
        </TabsTrigger>
      ))}
    </TabsList>
  )
}
