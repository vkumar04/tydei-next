"use client"

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Building2,
  TrendingUp,
  Gauge,
  Banknote,
} from "lucide-react"
import type {
  CurrentFinancialState,
  FacilityModelAssumptions,
} from "@/lib/financial-analysis/prospective-impact-model"
import { usdCompact } from "./format"
import { SliderField } from "./slider-field"

// ─── Current State cards ────────────────────────────────────────

function StatCard({
  icon: Icon,
  label,
  value,
  sublabel,
}: {
  icon: typeof Building2
  label: string
  value: string
  sublabel: string
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Icon className="h-4 w-4" />
          {label}
        </div>
        <div className="mt-2 text-2xl font-bold tabular-nums">{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sublabel}</div>
      </CardContent>
    </Card>
  )
}

export function CurrentStateCards({
  current,
}: {
  current: CurrentFinancialState
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Building2}
        label="Current Vendor Spend"
        value={usdCompact(current.vendorSpend)}
        sublabel="Total annual supply spend"
      />
      <StatCard
        icon={TrendingUp}
        label="Net Revenue"
        value={usdCompact(current.netRevenue)}
        sublabel="Facility top-line"
      />
      <StatCard
        icon={Gauge}
        label="EBITDA Estimate"
        value={usdCompact(current.ebitda)}
        sublabel={`At ${(current.ebitdaMarginPct * 100).toFixed(0)}% margin`}
      />
      <StatCard
        icon={Banknote}
        label="DCF Estimate"
        value={usdCompact(current.dcf)}
        sublabel="Discounted distributable cash flow"
      />
    </div>
  )
}

// ─── Financial Assumptions ──────────────────────────────────────

export function FinancialAssumptionsCard({
  assumptions,
  onChange,
}: {
  assumptions: FacilityModelAssumptions
  onChange: (next: FacilityModelAssumptions) => void
}) {
  const set = <K extends keyof FacilityModelAssumptions>(
    key: K,
    value: FacilityModelAssumptions[K],
  ) => onChange({ ...assumptions, [key]: value })

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Assumptions</CardTitle>
        <p className="text-sm text-muted-foreground">
          Tune these to match your facility. Every figure on this page
          recalculates instantly.
        </p>
      </CardHeader>
      <CardContent className="grid gap-x-8 gap-y-5 md:grid-cols-3">
        <SliderField
          label="Net revenue"
          value={assumptions.netRevenue}
          min={1_000_000}
          max={150_000_000}
          step={100_000}
          format={usdCompact}
          onChange={(v) => set("netRevenue", v)}
        />
        <SliderField
          label="Current vendor spend"
          value={assumptions.currentVendorSpend}
          min={500_000}
          max={60_000_000}
          step={100_000}
          format={usdCompact}
          onChange={(v) => set("currentVendorSpend", v)}
        />
        <SliderField
          label="Annual case volume"
          value={assumptions.annualCaseVolume}
          min={0}
          max={20_000}
          step={25}
          format={(v) => v.toLocaleString("en-US")}
          onChange={(v) => set("annualCaseVolume", v)}
        />
        <SliderField
          label="Supply cost % of revenue"
          value={assumptions.supplyCostPctOfRevenue}
          min={0}
          max={0.6}
          step={0.01}
          format={pct}
          onChange={(v) => set("supplyCostPctOfRevenue", v)}
        />
        <SliderField
          label="EBITDA margin"
          value={assumptions.ebitdaMarginPct}
          min={0}
          max={0.6}
          step={0.01}
          format={pct}
          onChange={(v) => set("ebitdaMarginPct", v)}
        />
        <SliderField
          label="Distributable cash flow % of EBITDA"
          value={assumptions.dcfPctOfEbitda}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => set("dcfPctOfEbitda", v)}
        />
        <SliderField
          label="Discount rate"
          value={assumptions.discountRatePct}
          min={0}
          max={0.3}
          step={0.005}
          format={pct}
          onChange={(v) => set("discountRatePct", v)}
        />
        <SliderField
          label="Cash flow growth"
          value={assumptions.cashFlowGrowthPct}
          min={0}
          max={0.2}
          step={0.005}
          format={pct}
          onChange={(v) => set("cashFlowGrowthPct", v)}
        />
        <SliderField
          label="DCF projection years"
          value={assumptions.dcfProjectionYears}
          min={1}
          max={15}
          step={1}
          format={(v) => `${v} yrs`}
          onChange={(v) => set("dcfProjectionYears", v)}
        />
      </CardContent>
    </Card>
  )
}
