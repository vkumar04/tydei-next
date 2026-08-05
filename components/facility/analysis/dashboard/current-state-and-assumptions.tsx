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
import { Input } from "@/components/ui/input"
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
  spendLabel = "Current Vendor Spend",
  spendSublabel = "Total annual supply spend",
}: {
  current: CurrentFinancialState
  /**
   * Overridable ONLY so the vendor-side Facility Current State panel can
   * label this figure honestly (it is the FACILITY'S total supply spend
   * there, sourced via a two-way connection — not "your data"). Facility
   * surfaces keep the defaults.
   */
  spendLabel?: string
  spendSublabel?: string
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <StatCard
        icon={Building2}
        label={spendLabel}
        value={usdCompact(current.vendorSpend)}
        sublabel={spendSublabel}
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
        sublabel={`Enterprise value · ${usdCompact(
          current.dcfExplicit,
        )} explicit + ${usdCompact(current.dcfTerminalValue)} terminal`}
      />
    </div>
  )
}

// ─── Net Revenue control (Actuals vs Manual) ────────────────────

export type RevenueMode = "actuals" | "manual"

export interface RevenueControl {
  mode: RevenueMode
  onModeChange: (mode: RevenueMode) => void
  /** Manual mode input: average reimbursement per case. */
  avgReimbursementPerCase: number
  onAvgReimbursementChange: (value: number) => void
  /** Actuals figure: summed case-costing reimbursement. */
  measuredReimbursement: number
  coverage: { withRate: number; totalCases: number }
  annualCaseVolume: number
  /** The effective net revenue currently driving the model. */
  netRevenue: number
}

function ModeToggle({
  mode,
  onModeChange,
}: {
  mode: RevenueMode
  onModeChange: (m: RevenueMode) => void
}) {
  return (
    <div className="inline-flex rounded-md border p-0.5 text-xs">
      {(["actuals", "manual"] as const).map((m) => (
        <button
          key={m}
          type="button"
          onClick={() => onModeChange(m)}
          className={cn(
            "rounded px-2 py-0.5 font-medium capitalize transition-colors",
            mode === m
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  )
}

function RevenueField({ revenue }: { revenue: RevenueControl }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">Revenue</span>
        <ModeToggle mode={revenue.mode} onModeChange={revenue.onModeChange} />
      </div>

      {revenue.mode === "actuals" ? (
        <div>
          <div className="text-lg font-bold tabular-nums">
            {usdCompact(revenue.measuredReimbursement)}
          </div>
          <p className="text-xs text-muted-foreground">
            Case-costing reimbursement, annualized from the selected window ·{" "}
            {revenue.coverage.withRate.toLocaleString("en-US")} of{" "}
            {revenue.coverage.totalCases.toLocaleString("en-US")} cases have a
            payor CPT rate.
            {revenue.coverage.withRate < revenue.coverage.totalCases
              ? " Load more payor contracts to raise coverage, or switch to Manual."
              : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <SliderField
            label="Avg reimbursement / case"
            value={revenue.avgReimbursementPerCase}
            min={0}
            max={100_000}
            step={500}
            format={(v) => usdCompact(v)}
            onChange={revenue.onAvgReimbursementChange}
            hint="Average revenue collected per surgical case. Net revenue = this × annual cases. Set the figure your CFO knows."
          />
          <p className="text-xs text-muted-foreground tabular-nums">
            × {revenue.annualCaseVolume.toLocaleString("en-US")} cases ={" "}
            <span className="font-semibold text-foreground">
              {usdCompact(revenue.netRevenue)}
            </span>{" "}
            net revenue
          </p>
        </div>
      )}
    </div>
  )
}

// ─── Financial Assumptions ──────────────────────────────────────

export function FinancialAssumptionsCard({
  assumptions,
  onChange,
  revenue,
  description = "Vendor spend comes from your tracked data; annual cases default from your case-costing data but can be overridden. Set the few figures only you know — every number on this page recalculates instantly.",
  spendRowLabel = "Vendor spend",
  spendSourceNote = "· from your data",
  spendEditable = false,
}: {
  assumptions: FacilityModelAssumptions
  onChange: (next: FacilityModelAssumptions) => void
  revenue: RevenueControl
  /**
   * Overridable ONLY for the vendor-side Facility Current State panel, where
   * the spend figure is the FACILITY'S data (two-way connection) or absent
   * entirely (one-way) — "from your data" would be a lie there. Facility
   * surfaces keep the defaults.
   */
  description?: string
  spendRowLabel?: string
  spendSourceNote?: string
  /** One-way vendor view (Vick 2026-07-04 "when it is a one way it should
   *  be able to enter in the supply spend manually"): the spend figure has
   *  no data source, so it becomes an editable manual assumption. Facility
   *  surfaces and two-way keep the read-only default. */
  spendEditable?: boolean
}) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const set = <K extends keyof FacilityModelAssumptions>(
    key: K,
    value: FacilityModelAssumptions[K],
  ) => onChange({ ...assumptions, [key]: value })

  const pct = (v: number) => `${Math.round(v * 100)}%`

  return (
    <Card>
      <CardHeader>
        <CardTitle>Financial Assumptions</CardTitle>
        <p className="text-sm text-muted-foreground">{description}</p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Vendor spend is tracked; annual cases seed from case-costing data
            but are editable so you can enter an actual / projected volume. */}
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-md bg-muted/40 px-3 py-2 text-sm">
          {spendEditable ? (
            <label className="flex items-center gap-2 text-muted-foreground">
              {spendRowLabel}
              <Input
                type="number"
                min={0}
                step={1000}
                value={assumptions.currentVendorSpend}
                onChange={(e) =>
                  set(
                    "currentVendorSpend",
                    Math.max(0, Number(e.target.value) || 0),
                  )
                }
                className="h-7 w-32 font-semibold tabular-nums"
              />
              <span className="text-xs">{spendSourceNote}</span>
            </label>
          ) : (
            <span className="text-muted-foreground">
              {spendRowLabel}{" "}
              <span className="font-semibold tabular-nums text-foreground">
                {usdCompact(assumptions.currentVendorSpend)}
              </span>{" "}
              <span className="text-xs">{spendSourceNote}</span>
            </span>
          )}
          <label className="flex items-center gap-2 text-muted-foreground">
            Annual cases
            <Input
              type="number"
              min={0}
              step={1}
              value={assumptions.annualCaseVolume}
              onChange={(e) =>
                set(
                  "annualCaseVolume",
                  Math.max(0, Math.round(Number(e.target.value) || 0)),
                )
              }
              className="h-7 w-24 font-semibold tabular-nums"
            />
            <span className="text-xs">· default from your data, editable</span>
          </label>
        </div>

        {/* The three figures only the facility knows */}
        <div className="grid gap-x-8 gap-y-5 md:grid-cols-3">
          <RevenueField revenue={revenue} />
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
              <SliderField
                label="Terminal growth"
                value={assumptions.terminalGrowthPct ?? 0.03}
                min={0}
                max={0.05}
                step={0.0025}
                format={(v) => `${(v * 100).toFixed(2)}%`}
                onChange={(v) => set("terminalGrowthPct", v)}
                hint="Perpetuity growth rate for the terminal value (the value of all cash flow beyond the projection window). Anchored to long-run GDP, typically 2–3%. Must stay below the discount rate; the terminal value is TV = FCF × (1 + g) / (discount − g)."
              />
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}
