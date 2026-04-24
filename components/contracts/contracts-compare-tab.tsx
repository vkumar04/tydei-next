"use client"

import { useMemo } from "react"
import { ArrowLeftRight, Check } from "lucide-react"
import type { useContracts } from "@/hooks/use-contracts"
import { formatCurrency, formatCalendarDate } from "@/lib/formatting"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

// ─── Compare Tab — Subsystem 4 ─────────────────────────────────────
// Supports up to 5 contracts side-by-side. Five cards per spec §4.4:
//   1. Contract Overview
//   2. Rebate Terms
//   3. Financial Performance
//   4. Pricing Items
//   5. Contract Terms

type ContractRow = ReturnType<
  typeof useContracts
>["data"] extends { contracts: infer R } | undefined
  ? R extends readonly (infer One)[]
    ? One
    : never
  : never

interface CompareTabProps {
  contracts: ContractRow[]
  selected: string[]
  onToggle: (id: string) => void
  onClear: () => void
}

export function CompareTab({
  contracts,
  selected,
  onToggle,
  onClear,
}: CompareTabProps) {
  const selectedContracts = useMemo(
    () =>
      selected
        .map((id) => contracts.find((c) => c.id === id))
        .filter((c): c is ContractRow => Boolean(c)),
    [selected, contracts]
  )

  return (
    <div className="space-y-6">
      {/* Contract Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Select Contracts to Compare</CardTitle>
          <CardDescription>
            Choose 2-5 contracts to compare side by side
          </CardDescription>
        </CardHeader>
        <CardContent>
          {contracts.length === 0 ? (
            <div className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              No contracts match the current filters.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {contracts.map((contract) => {
                const isSelected = selected.includes(contract.id)
                const disabled = selected.length >= 5 && !isSelected
                return (
                  <button
                    type="button"
                    key={contract.id}
                    onClick={() => onToggle(contract.id)}
                    disabled={disabled}
                    className={`rounded-lg border-2 p-4 text-left transition-all ${
                      isSelected
                        ? "border-primary bg-primary/5"
                        : "border-border hover:border-primary/50"
                    } ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="font-semibold">{contract.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {contract.vendor.name}
                        </p>
                      </div>
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded-full border-2 ${
                          isSelected
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-muted-foreground"
                        }`}
                      >
                        {isSelected && <Check className="h-3 w-3" />}
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Value</p>
                        <p className="font-medium">
                          {formatCurrency(Number(contract.totalValue))}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Type</p>
                        <p className="font-medium capitalize">
                          {contract.contractType.replace("_", " ")}
                        </p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
          {selected.length > 0 && (
            <div className="mt-4 flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                {selected.length} contract{selected.length === 1 ? "" : "s"} selected
              </p>
              <Button variant="outline" size="sm" onClick={onClear}>
                Clear Selection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Comparison Cards */}
      {selectedContracts.length >= 2 ? (
        <div className="space-y-4">
          <CompareOverviewCard contracts={selectedContracts} />
          <CompareRebateTermsCard contracts={selectedContracts} />
          <CompareFinancialCard contracts={selectedContracts} />
          <ComparePricingItemsCard contracts={selectedContracts} />
          <CompareContractTermsCard contracts={selectedContracts} />
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <ArrowLeftRight className="mx-auto mb-4 h-12 w-12 text-muted-foreground/50" />
            <p className="text-muted-foreground">
              Select at least 2 contracts above to see the comparison
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ─── Compare cards ─────────────────────────────────────────────────

function useCompareGridStyle(count: number) {
  return useMemo<React.CSSProperties>(
    () => ({
      display: "grid",
      gridTemplateColumns: `150px repeat(${count}, minmax(180px, 1fr))`,
      gap: "0",
    }),
    [count]
  )
}

function CompareSection({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">{children}</div>
      </CardContent>
    </Card>
  )
}

function CompareRow({
  label,
  children,
  style,
}: {
  label: string
  children: React.ReactNode[]
  style: React.CSSProperties
}) {
  return (
    <div
      className="border-b py-3 text-sm last:border-b-0"
      style={style}
    >
      <div className="font-medium text-muted-foreground">{label}</div>
      {children.map((cell, i) => (
        <div key={i} className="pr-4">
          {cell}
        </div>
      ))}
    </div>
  )
}

function statusBadge(status: string | null | undefined) {
  const s = status ?? "draft"
  const cls =
    s === "active"
      ? "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300"
      : s === "expired"
        ? "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300"
        : s === "pending"
          ? "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-300"
          : "bg-muted text-muted-foreground"
  return (
    <Badge variant="secondary" className={cls}>
      {s.charAt(0).toUpperCase() + s.slice(1)}
    </Badge>
  )
}

function CompareOverviewCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Contract Overview"
      description="Side-by-side comparison of key attributes"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Attribute</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Vendor"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.vendor.name}</span>
        ))}
      />
      <CompareRow
        label="Type"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="capitalize">
            {c.contractType.replace("_", " ")}
          </span>
        ))}
      />
      <CompareRow
        label="Status"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{statusBadge(c.status)}</span>
        ))}
      />
      <CompareRow
        label="Effective"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.effectiveDate ? formatCalendarDate(c.effectiveDate) : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Expiration"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.expirationDate ? formatCalendarDate(c.expirationDate) : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Total Value"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="font-medium">
            {formatCurrency(Number(c.totalValue))}
          </span>
        ))}
      />
      <CompareRow
        label="Rebates Earned"
        style={style}
        children={contracts.map((c) => {
          const v = getRebateEarned(c)
          return (
            <span
              key={c.id}
              className="font-medium text-green-600 dark:text-green-400"
            >
              {formatCurrency(v)}
            </span>
          )
        })}
      />
      <CompareRow
        label="Facility"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.facility?.name ?? "All Facilities"}</span>
        ))}
      />
    </CompareSection>
  )
}

function CompareRebateTermsCard({ contracts }: { contracts: ContractRow[] }) {
  return (
    <CompareSection
      title="Rebate Terms"
      description="Tiered structures per contract (best effort from summary data)"
    >
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: `repeat(${contracts.length}, minmax(180px, 1fr))` }}
      >
        {contracts.map((c) => (
          <div key={c.id} className="rounded-md border p-3">
            <p className="mb-2 font-semibold">{c.name}</p>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div className="flex items-center justify-between">
                <span>Performance</span>
                <span className="capitalize text-foreground">
                  {c.performancePeriod ?? "monthly"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Rebate Pay</span>
                <span className="capitalize text-foreground">
                  {c.rebatePayPeriod ?? "quarterly"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Current Spend</span>
                <span className="text-foreground">
                  {formatCurrency(getCurrentSpend(c) ?? 0)}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Earned</span>
                <span className="font-medium text-green-600 dark:text-green-400">
                  {formatCurrency(getRebateEarned(c))}
                </span>
              </div>
              {c.gpoAffiliation && (
                <div className="flex items-center justify-between">
                  <span>GPO</span>
                  <span className="text-foreground">{c.gpoAffiliation}</span>
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </CompareSection>
  )
}

function CompareFinancialCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Financial Performance"
      description="Spend, rebates, and effective rates"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Metric</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Total Spend"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="font-medium">
            {formatCurrency(getCurrentSpend(c) ?? 0)}
          </span>
        ))}
      />
      <CompareRow
        label="Rebates Earned"
        style={style}
        children={contracts.map((c) => (
          <span
            key={c.id}
            className="font-medium text-green-600 dark:text-green-400"
          >
            {formatCurrency(getRebateEarned(c))}
          </span>
        ))}
      />
      <CompareRow
        label="Rebates Collected"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{formatCurrency(Number(c.rebateCollected ?? 0))}</span>
        ))}
      />
      <CompareRow
        label="Outstanding"
        style={style}
        children={contracts.map((c) => {
          const earned = getRebateEarned(c)
          const collected = Number(c.rebateCollected ?? 0)
          const outstanding = Math.max(earned - collected, 0)
          return (
            <span
              key={c.id}
              className={
                outstanding > 0
                  ? "font-medium text-amber-600 dark:text-amber-400"
                  : "text-muted-foreground"
              }
            >
              {formatCurrency(outstanding)}
            </span>
          )
        })}
      />
      <CompareRow
        label="Effective Rate"
        style={style}
        children={contracts.map((c) => {
          const spend = getCurrentSpend(c) ?? 0
          const earned = getRebateEarned(c)
          const rate = spend > 0 ? (earned / spend) * 100 : 0
          const cls =
            rate >= 5
              ? "text-green-600 dark:text-green-400"
              : rate >= 2
                ? "text-blue-600 dark:text-blue-400"
                : "text-muted-foreground"
          return (
            <span key={c.id} className={`font-medium ${cls}`}>
              {spend > 0 ? `${rate.toFixed(2)}%` : "—"}
            </span>
          )
        })}
      />
    </CompareSection>
  )
}

function ComparePricingItemsCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Pricing Items"
      description="Category coverage and pricing footprint"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Metric</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Primary Category"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.productCategory?.name ?? "—"}</span>
        ))}
      />
      <CompareRow
        label="Annual Value"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{formatCurrency(Number(c.annualValue ?? 0))}</span>
        ))}
      />
      <CompareRow
        label="Total Value"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="font-medium">
            {formatCurrency(Number(c.totalValue))}
          </span>
        ))}
      />
      <CompareRow
        label="Avg Monthly Value"
        style={style}
        children={contracts.map((c) => {
          const months = monthsBetween(c.effectiveDate, c.expirationDate)
          const avg =
            months > 0 ? Number(c.totalValue) / months : Number(c.totalValue)
          return <span key={c.id}>{formatCurrency(avg)}</span>
        })}
      />
    </CompareSection>
  )
}

function CompareContractTermsCard({ contracts }: { contracts: ContractRow[] }) {
  const style = useCompareGridStyle(contracts.length)
  return (
    <CompareSection
      title="Contract Terms"
      description="Duration, commitments, and scope"
    >
      <div
        className="grid border-b pb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        style={style}
      >
        <div>Metric</div>
        {contracts.map((c) => (
          <div key={c.id} className="truncate pr-4 text-foreground">
            {c.name}
          </div>
        ))}
      </div>
      <CompareRow
        label="Duration"
        style={style}
        children={contracts.map((c) => {
          const months = monthsBetween(c.effectiveDate, c.expirationDate)
          return <span key={c.id}>{months > 0 ? `${months} months` : "—"}</span>
        })}
      />
      <CompareRow
        label="Days Remaining"
        style={style}
        children={contracts.map((c) => {
          const days = daysUntil(c.expirationDate)
          const cls =
            days < 0
              ? "text-red-600 dark:text-red-400"
              : days < 30
                ? "text-amber-600 dark:text-amber-400"
                : days < 180
                  ? "text-yellow-600 dark:text-yellow-400"
                  : "text-foreground"
          return (
            <span key={c.id} className={`font-medium ${cls}`}>
              {Number.isFinite(days) ? `${days} days` : "—"}
            </span>
          )
        })}
      />
      <CompareRow
        label="Expiring Soon"
        style={style}
        children={contracts.map((c) => {
          const days = daysUntil(c.expirationDate)
          if (days > 0 && days < 180) {
            return (
              <Badge
                key={c.id}
                variant="secondary"
                className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300"
              >
                Expiring Soon
              </Badge>
            )
          }
          return <span key={c.id}>—</span>
        })}
      />
      <CompareRow
        label="Auto Renewal"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>{c.autoRenewal ? "Yes" : "No"}</span>
        ))}
      />
      <CompareRow
        label="Scope"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id} className="capitalize">
            {c.isMultiFacility ? "Multi-facility" : "Single facility"}
          </span>
        ))}
      />
      <CompareRow
        label="Termination Notice"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.terminationNoticeDays
              ? `${c.terminationNoticeDays} days`
              : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Market Share Commit"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.marketShareCommitment !== null &&
            c.marketShareCommitment !== undefined
              ? `${Number(c.marketShareCommitment).toFixed(1)}%`
              : "—"}
          </span>
        ))}
      />
      <CompareRow
        label="Compliance Rate"
        style={style}
        children={contracts.map((c) => (
          <span key={c.id}>
            {c.complianceRate !== null && c.complianceRate !== undefined
              ? `${Number(c.complianceRate).toFixed(1)}%`
              : "—"}
          </span>
        ))}
      />
    </CompareSection>
  )
}

// ─── helpers ───────────────────────────────────────────────────────

function getCurrentSpend(c: ContractRow): number | undefined {
  return c.currentSpend
}
function getRebateEarned(c: ContractRow): number {
  return Number(c.rebateEarned ?? 0)
}

function monthsBetween(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined
): number {
  if (!start || !end) return 0
  const s = new Date(start)
  const e = new Date(end)
  const ms = e.getTime() - s.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round(ms / (1000 * 60 * 60 * 24 * 30.44))
}

function daysUntil(end: Date | string | null | undefined): number {
  if (!end) return Number.NaN
  const ms = new Date(end).getTime() - Date.now()
  return Math.round(ms / (1000 * 60 * 60 * 24))
}
