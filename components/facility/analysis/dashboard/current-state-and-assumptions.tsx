"use client"

import { useState } from "react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Building2,
  TrendingUp,
  Gauge,
  Banknote,
  ChevronDown,
} from "lucide-react"
import type {
  CurrentFinancialState,
  FacilityModelAssumptions,
} from "@/lib/financial-analysis/prospective-impact-model"
import { cn } from "@/lib/utils"
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
  hasData,
}: {
  assumptions: FacilityModelAssumptions
  onChange: (next: FacilityModelAssumptions) => void
  /** True when the facility has tracked COG. False → new-account input mode. */
  hasData: boolean
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const set = <K extends keyof FacilityModelAssumptions>(
    key: K,
    value: FacilityModelAssumptions[K],
  ) => onChange({ ...assumptions, [key]: value })

  const pct = (v: number) => `${Math.round(v * 100)}%`

  // New-account mode: vendor spend is derived from implant cost/case × volume,
  // since there's no tracked COG to read it from (Vick 2026-06-21).
  const implantCostPerCase = assumptions.implantCostPerCase ?? 2_500
  const setNewAccountSpend = (costPerCase: number, volume: number) =>
    onChange({
      ...assumptions,
      implantCostPerCase: costPerCase,
      annualCaseVolume: volume,
      currentVendorSpend: costPerCase * volume,
    })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Assumptions</CardTitle>
        <p className="text-sm text-muted-foreground">
          {hasData
            ? "Vendor spend and case volume come from your tracked data. Set the few figures only you know — every number on this page recalculates instantly."
            : "No tracked data yet — enter your implant cost per case and volume to derive spend, plus the figures only you know. Every number recalculates instantly."}
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {hasData ? (
          /* Tracked from the system — not editable here */
          <div className="flex flex-wrap gap-x-6 gap-y-1 rounded-md bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">
              Vendor spend{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {usdCompact(assumptions.currentVendorSpend)}
              </span>{" "}
              <span className="text-xs">· from your data</span>
            </span>
            <span className="text-muted-foreground">
              Annual cases{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {assumptions.annualCaseVolume.toLocaleString("en-US")}
              </span>{" "}
              <span className="text-xs">· from your data</span>
            </span>
          </div>
        ) : (
          /* New account: type implant cost/case + volume → derives spend */
          <div className="space-y-3 rounded-md border border-dashed p-3">
            <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
              <SliderField
                label="Implant / supply cost per case"
                value={implantCostPerCase}
                min={0}
                max={50_000}
                step={250}
                format={usdCompact}
                onChange={(v) => setNewAccountSpend(v, assumptions.annualCaseVolume)}
                hint="Total implant/supply cost for a typical case. Multiplied by annual volume to derive your vendor spend."
              />
              <SliderField
                label="Annual case volume"
                value={assumptions.annualCaseVolume}
                min={0}
                max={20_000}
                step={25}
                format={(v) => v.toLocaleString("en-US")}
                onChange={(v) => setNewAccountSpend(implantCostPerCase, v)}
                hint="Surgical cases per year. With cost/case this derives total vendor spend."
              />
            </div>
            <div className="text-sm text-muted-foreground">
              Derived vendor spend{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {usdCompact(assumptions.currentVendorSpend)}
              </span>{" "}
              <span className="text-xs">
                = {usdCompact(implantCostPerCase)}/case ×{" "}
                {assumptions.annualCaseVolume.toLocaleString("en-US")} cases
              </span>
            </div>
          </div>
        )}

        {/* The three figures only the facility knows */}
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
          <SliderField
            label="Revenue"
            value={assumptions.netRevenue}
            min={1_000_000}
            max={150_000_000}
            step={100_000}
            format={usdCompact}
            onChange={(v) => set("netRevenue", v)}
            hint="Total annual top-line revenue the facility collects. EBITDA, DCF, and enterprise value all scale from this."
          />
          <SliderField
            label="Current EBITDA margin"
            value={assumptions.ebitdaMarginPct}
            min={0}
            max={0.6}
            step={0.01}
            format={pct}
            onChange={(v) => set("ebitdaMarginPct", v)}
            hint="Operating profit (EBITDA) as a share of revenue. EBITDA = revenue × this margin."
          />
          <SliderField
            label="DCF % of EBITDA"
            value={assumptions.dcfPctOfEbitda}
            min={0}
            max={1}
            step={0.01}
            format={pct}
            onChange={(v) => set("dcfPctOfEbitda", v)}
            hint="Share of EBITDA that converts to distributable cash flow each year (after tax, capex, working capital). Drives the DCF base."
          />
        </div>

        {/* DCF mechanics — defaulted, opened only if you want to tune them */}
        <div>
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ChevronDown
              className={cn(
                "h-4 w-4 transition-transform",
                showAdvanced && "rotate-180",
              )}
            />
            Advanced (DCF settings)
          </button>
          {showAdvanced ? (
            <div className="mt-4 grid gap-x-8 gap-y-5 md:grid-cols-3">
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
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
