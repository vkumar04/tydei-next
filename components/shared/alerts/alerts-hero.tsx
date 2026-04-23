"use client"

import { Bell, Check, CheckCircle2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

/**
 * Hero banner for the facility Alerts page. Collapses what were previously
 * a plain page header + four stacked summary cards into one elevated,
 * scannable top-of-page unit:
 *
 *   1. Eyebrow + headline sentence (how many unresolved, what needs action)
 *   2. Status pill ("All clear" / "Action needed") + "Mark All Read" action
 *   3. Four hero stats separated by `border-y py-6`:
 *        Off-Contract, Expiring, Rebates Due, Total Unresolved
 *
 * No Card wrapper — this is a top-level hero. The rounded border + shadow
 * render as an elevated plane rather than another box among boxes.
 */
export interface AlertsHeroProps {
  offContractCount: number
  expiringCount: number
  rebatesDueCount: number
  totalUnresolved: number
  unreadCount: number
  onMarkAllRead: () => void
  isMarkingAllRead: boolean
}

export function AlertsHero({
  offContractCount,
  expiringCount,
  rebatesDueCount,
  totalUnresolved,
  unreadCount,
  onMarkAllRead,
  isMarkingAllRead,
}: AlertsHeroProps) {
  const hasCritical = offContractCount > 0
  const hasAny = totalUnresolved > 0

  const headline = hasAny
    ? `${totalUnresolved} unresolved${
        unreadCount > 0 ? ` · ${unreadCount} unread` : ""
      }${hasCritical ? ` · ${offContractCount} off-contract requiring attention` : ""}`
    : "You're all caught up"

  return (
    <section className="rounded-xl border bg-card p-6 shadow-sm sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <Bell className="h-3.5 w-3.5" />
            Alerts
          </div>
          <h2 className="text-balance text-xl font-semibold leading-tight sm:text-2xl">
            {headline}
          </h2>
          <p className="text-sm text-muted-foreground">
            Notifications about contracts, purchases, and rebates
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasAny ? (
            <Badge
              variant="secondary"
              className={
                hasCritical
                  ? "gap-1.5 bg-red-100 text-red-900 dark:bg-red-900/40 dark:text-red-100"
                  : "gap-1.5 bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-100"
              }
            >
              <Bell className="h-3.5 w-3.5" />
              {hasCritical ? "Action needed" : "Review pending"}
            </Badge>
          ) : (
            <Badge
              variant="secondary"
              className="gap-1.5 bg-emerald-100 text-emerald-900 dark:bg-emerald-900/40 dark:text-emerald-100"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              All clear
            </Badge>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={onMarkAllRead}
            disabled={isMarkingAllRead || unreadCount === 0}
          >
            <Check className="mr-2 h-4 w-4" />
            Mark All Read
          </Button>
        </div>
      </div>

      <div className="mt-8 grid gap-6 border-y py-6 sm:grid-cols-2 lg:grid-cols-4">
        <HeroStat
          label="Off-Contract"
          value={String(offContractCount)}
          sublabel="Purchases outside active contracts"
          tone={offContractCount > 0 ? "negative" : "muted"}
        />
        <HeroStat
          label="Expiring"
          value={String(expiringCount)}
          sublabel="Contracts needing renewal"
          tone={expiringCount > 0 ? "warning" : "muted"}
        />
        <HeroStat
          label="Rebates Due"
          value={String(rebatesDueCount)}
          sublabel="Awaiting collection"
          tone={rebatesDueCount > 0 ? "positive" : "muted"}
        />
        <HeroStat
          label="Total Unresolved"
          value={String(totalUnresolved)}
          sublabel={unreadCount > 0 ? `${unreadCount} unread` : "All read"}
        />
      </div>
    </section>
  )
}

interface HeroStatProps {
  label: string
  value: string
  sublabel: string
  tone?: "positive" | "negative" | "warning" | "muted"
}

function HeroStat({ label, value, sublabel, tone }: HeroStatProps) {
  const sublabelClass =
    tone === "positive"
      ? "text-emerald-700 dark:text-emerald-400"
      : tone === "negative"
        ? "text-red-700 dark:text-red-400"
        : tone === "warning"
          ? "text-amber-700 dark:text-amber-400"
          : "text-muted-foreground"
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <p className="text-3xl font-semibold tabular-nums tracking-tight sm:text-4xl">
        {value}
      </p>
      <p className={`text-xs ${sublabelClass}`}>{sublabel}</p>
    </div>
  )
}
