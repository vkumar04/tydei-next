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
          hint="Total annual top-line revenue the facility collects. EBITDA, DCF, and enterprise value all scale from this."
        />
        <SliderField
          label="Current vendor spend"
          value={assumptions.currentVendorSpend}
          min={500_000}
          max={60_000_000}
          step={100_000}
          format={usdCompact}
          onChange={(v) => set("currentVendorSpend", v)}
          hint="Total annual supply / vendor (COG) spend. The base the negotiated saving is calculated against."
        />
        <SliderField
          label="Annual case volume"
          value={assumptions.annualCaseVolume}
          min={0}
          max={20_000}
          step={25}
          format={(v) => v.toLocaleString("en-US")}
          onChange={(v) => set("annualCaseVolume", v)}
          hint="Number of surgical cases per year. Used to spread the dollar impact down to a per-case figure."
        />
        <SliderField
          label="Supply cost % of revenue"
          value={assumptions.supplyCostPctOfRevenue}
          min={0}
          max={0.6}
          step={0.01}
          format={pct}
          onChange={(v) => set("supplyCostPctOfRevenue", v)}
          hint="Supply spend as a share of revenue (vendor spend ÷ net revenue). A common benchmark is ~25–35% for an ASC."
        />
        <SliderField
          label="EBITDA margin"
          value={assumptions.ebitdaMarginPct}
          min={0}
          max={0.6}
          step={0.01}
          format={pct}
          onChange={(v) => set("ebitdaMarginPct", v)}
          hint="Operating profit (EBITDA) as a share of net revenue. EBITDA = net revenue × this margin."
        />
        <SliderField
          label="Distributable cash flow % of EBITDA"
          value={assumptions.dcfPctOfEbitda}
          min={0}
          max={1}
          step={0.01}
          format={pct}
          onChange={(v) => set("dcfPctOfEbitda", v)}
          hint="Share of EBITDA that converts to distributable cash flow each year (after tax, capex, working capital). Drives the DCF base."
        />
        <SliderField
          label="Discount rate"
          value={assumptions.discountRatePct}
          min={0}
          max={0.3}
          step={0.005}
          format={pct}
          onChange={(v) => set("discountRatePct", v)}
          hint="Annual rate that converts future cash flows to today's dollars in the DCF. Higher rate → future cash worth less now → lower DCF and enterprise value. Typically 8–12% for an ASC."
        />
        <SliderField
          label="Cash flow growth"
          value={assumptions.cashFlowGrowthPct}
          min={0}
          max={0.2}
          step={0.005}
          format={pct}
          onChange={(v) => set("cashFlowGrowthPct", v)}
          hint="Expected annual growth of distributable cash flow over the projection window. Each year's cash flow grows at this rate before discounting."
        />
        <SliderField
          label="DCF projection years"
          value={assumptions.dcfProjectionYears}
          min={1}
          max={15}
          step={1}
          format={(v) => `${v} yrs`}
          onChange={(v) => set("dcfProjectionYears", v)}
          hint="Number of years of cash flow included in the discounted cash flow calculation."
        />
      </CardContent>
    </Card>
  )
}
