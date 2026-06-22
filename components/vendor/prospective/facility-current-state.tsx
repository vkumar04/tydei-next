"use client"

/**
 * Vendor pitch view — a target facility's "Current State" financials.
 *
 * Surfaces the same Current Vendor Spend / Net Revenue / EBITDA / DCF cards
 * the facility CFO sees (Vick 2026-06-22: "these numbers are relevant for
 * each facility a vendor is pitching"), scoped to ONE facility the vendor
 * has a relationship with. Reuses the facility-Analysis model
 * (`computeFacilityProspectiveModel`) and presentational cards verbatim so
 * the two surfaces can never drift; only the data seed is vendor-scoped
 * (`getFacilityCurrentStateForVendor` → measurable seeds, no competitor mix).
 */

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Label } from "@/components/ui/label"
import { Building } from "lucide-react"
import { queryKeys } from "@/lib/query-keys"
import {
  getFacilityCurrentStateForVendor,
  type VendorFacilityCurrentState,
} from "@/lib/actions/vendor-prospective"
import {
  computeFacilityProspectiveModel,
  DEFAULT_FACILITY_ASSUMPTIONS,
  type FacilityModelAssumptions,
} from "@/lib/financial-analysis/prospective-impact-model"
import {
  CurrentStateCards,
  FinancialAssumptionsCard,
  type RevenueMode,
} from "@/components/facility/analysis/dashboard/current-state-and-assumptions"

interface FacilityOption {
  id: string
  name: string
}

/** Supply cost as a share of revenue for the manual-mode fallback seed. */
const IMPLIED_SUPPLY_COST_PCT = 0.3

export function FacilityCurrentStatePanel({
  vendorId,
  facilities,
}: {
  vendorId: string
  facilities: FacilityOption[]
}) {
  const [facilityId, setFacilityId] = useState<string>(
    () => facilities[0]?.id ?? "",
  )

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.prospectiveAnalysis.vendorFacilityCurrentState(
      vendorId,
      facilityId,
    ),
    queryFn: () => getFacilityCurrentStateForVendor(facilityId),
    enabled: Boolean(facilityId),
  })

  return (
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Building className="h-4 w-4 text-primary" />
              Facility Current State
            </h3>
            <p className="text-sm text-muted-foreground">
              The financial picture of the facility you&apos;re pitching —
              spend, revenue, EBITDA, and enterprise value (DCF).
            </p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="fcs-facility" className="text-xs">
              Facility
            </Label>
            <Select value={facilityId} onValueChange={setFacilityId}>
              <SelectTrigger id="fcs-facility" className="w-[240px]">
                <SelectValue placeholder="Select a facility" />
              </SelectTrigger>
              <SelectContent>
                {facilities.map((f) => (
                  <SelectItem key={f.id} value={f.id}>
                    {f.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {facilities.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No related facilities yet. Once you have contracts, COG history, or
            a submitted proposal with a facility, it will appear here.
          </p>
        ) : isLoading || !data ? (
          <Skeleton className="h-[360px] rounded-xl" />
        ) : (
          <FacilityCurrentStateModel key={facilityId} data={data} />
        )}
      </CardContent>
    </Card>
  )
}

/**
 * Inner model: holds the assumption + Net Revenue control state, seeded from
 * `data`. Remounted via `key={facilityId}` on facility change so state resets
 * cleanly without a reset effect (CLAUDE.md "derive, don't mirror").
 *
 * Seed logic mirrors `analysis-dashboard-client.tsx` (seedAssumptions /
 * seedRevenue) — kept local because the vendor data shape omits the facility
 * breakdown; the meaningful reuse is the model + the cards.
 */
function FacilityCurrentStateModel({
  data,
}: {
  data: VendorFacilityCurrentState
}) {
  const cases = data.annualCaseVolume || DEFAULT_FACILITY_ASSUMPTIONS.annualCaseVolume
  const coveredAvg =
    data.reimbursementCoverage.withRate > 0
      ? data.measuredReimbursement / data.reimbursementCoverage.withRate
      : 0
  // Actuals only when reimbursement is coherent (exceeds supply spend); else
  // Manual, seeded from the real per-covered-case average (NOT the spend÷30%
  // proxy) so EBITDA doesn't collapse onto vendor spend.
  const revenueIsImplied = data.measuredReimbursement <= data.currentVendorSpend
  const impliedPerCase =
    cases > 0 ? data.currentVendorSpend / IMPLIED_SUPPLY_COST_PCT / cases : 0

  const [assumptions, setAssumptions] = useState<FacilityModelAssumptions>(
    () => ({
      ...DEFAULT_FACILITY_ASSUMPTIONS,
      currentVendorSpend:
        data.currentVendorSpend || DEFAULT_FACILITY_ASSUMPTIONS.currentVendorSpend,
      annualCaseVolume: cases,
    }),
  )
  const [revenueMode, setRevenueMode] = useState<RevenueMode>(
    () => (revenueIsImplied ? "manual" : "actuals"),
  )
  const [avgReimbursementPerCase, setAvgReimbursementPerCase] = useState<number>(
    () => (coveredAvg > 0 ? coveredAvg : impliedPerCase),
  )

  const effectiveNetRevenue =
    revenueMode === "actuals"
      ? data.measuredReimbursement
      : avgReimbursementPerCase * assumptions.annualCaseVolume

  const effectiveAssumptions = useMemo<FacilityModelAssumptions>(
    () => ({ ...assumptions, netRevenue: effectiveNetRevenue }),
    [assumptions, effectiveNetRevenue],
  )

  // No negotiated saving here — this is the facility's CURRENT state; the
  // deal scenario lives in the Opportunity Engine below.
  const model = useMemo(
    () => computeFacilityProspectiveModel(effectiveAssumptions, 0),
    [effectiveAssumptions],
  )

  return (
    <div className="space-y-4">
      <CurrentStateCards current={model.current} />
      <FinancialAssumptionsCard
        assumptions={effectiveAssumptions}
        onChange={setAssumptions}
        revenue={{
          mode: revenueMode,
          onModeChange: setRevenueMode,
          avgReimbursementPerCase,
          onAvgReimbursementChange: setAvgReimbursementPerCase,
          measuredReimbursement: data.measuredReimbursement,
          coverage: data.reimbursementCoverage,
          annualCaseVolume: assumptions.annualCaseVolume,
          netRevenue: effectiveNetRevenue,
        }}
      />
    </div>
  )
}
