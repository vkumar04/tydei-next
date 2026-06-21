/**
 * AI Growth Simulator — Charles AI Prospective Impact Engine, feature #7
 * (2026-06-21).
 *
 * Pure function. A "what-if" engine: adjust the growth levers (volume, payer
 * mix, vendor share consolidation, robotics throughput, new surgeons) and
 * see EBITDA / DCF / EV / margin move in real time. Built directly on top of
 * the core {@link computeFacilityProspectiveModel} so every number stays
 * consistent with the rest of the dashboard.
 */

import {
  computeFacilityProspectiveModel,
  EV_MULTIPLES,
  type FacilityModelAssumptions,
} from "./prospective-impact-model"

export interface GrowthLevers {
  /** Incremental case-volume growth, fraction (0.10 = +10%). */
  volumeGrowthPct: number
  /** Net-revenue-per-case lift from a better payer mix, fraction. */
  payerMixLiftPct: number
  /** Supply spend reduced by consolidating vendor share, fraction of spend. */
  vendorShareConsolidationPct: number
  /** Extra throughput unlocked by robotics, fraction. */
  roboticsThroughputPct: number
  /** Revenue lift from newly recruited surgeons, fraction. */
  newSurgeonRevenuePct: number
}

export interface GrowthSimulatorOutputs {
  netRevenue: number
  ebitda: number
  ebitdaMarginPct: number
  dcf: number
  /** EV at the "expected" (12×) multiple. */
  ev: number
}

export interface GrowthSimulatorResult {
  base: GrowthSimulatorOutputs
  simulated: GrowthSimulatorOutputs
  delta: {
    netRevenue: number
    ebitda: number
    ebitdaMarginPoints: number
    dcf: number
    ev: number
  }
}

export const ZERO_GROWTH_LEVERS: GrowthLevers = {
  volumeGrowthPct: 0,
  payerMixLiftPct: 0,
  vendorShareConsolidationPct: 0,
  roboticsThroughputPct: 0,
  newSurgeonRevenuePct: 0,
}

export function computeGrowthSimulation(
  assumptions: FacilityModelAssumptions,
  levers: GrowthLevers,
): GrowthSimulatorResult {
  const expectedMultiple = EV_MULTIPLES.expected

  // ── Base (no levers) ─────────────────────────────────────────
  const baseModel = computeFacilityProspectiveModel(assumptions, 0)
  const base: GrowthSimulatorOutputs = {
    netRevenue: baseModel.current.netRevenue,
    ebitda: baseModel.current.ebitda,
    ebitdaMarginPct: baseModel.current.ebitdaMarginPct,
    dcf: baseModel.current.dcf,
    ev: baseModel.current.ebitda * expectedMultiple,
  }

  // ── Apply levers ─────────────────────────────────────────────
  // Volume-like levers compound on revenue; payer mix lifts revenue/case.
  const volumeMultiplier =
    (1 + levers.volumeGrowthPct) *
    (1 + levers.roboticsThroughputPct) *
    (1 + levers.newSurgeonRevenuePct)
  const simNetRevenue =
    assumptions.netRevenue * volumeMultiplier * (1 + levers.payerMixLiftPct)

  // Vendor-share consolidation is a supply saving — flows to EBITDA.
  const supplySavings =
    assumptions.currentVendorSpend * levers.vendorShareConsolidationPct

  const simAssumptions: FacilityModelAssumptions = {
    ...assumptions,
    netRevenue: simNetRevenue,
  }
  const simModel = computeFacilityProspectiveModel(simAssumptions, supplySavings)

  const simulated: GrowthSimulatorOutputs = {
    netRevenue: simModel.current.netRevenue,
    ebitda: simModel.impact.futureEbitda,
    ebitdaMarginPct: simModel.impact.futureEbitdaMarginPct,
    // DCF on the post-savings distributable cash flow.
    dcf:
      simModel.current.dcf +
      simModel.impact.impactToDistributableCashFlow *
        (simModel.current.dcf / simModel.current.distributableCashFlowPerYear || 0),
    ev: simModel.impact.futureEbitda * expectedMultiple,
  }

  return {
    base,
    simulated,
    delta: {
      netRevenue: simulated.netRevenue - base.netRevenue,
      ebitda: simulated.ebitda - base.ebitda,
      ebitdaMarginPoints:
        (simulated.ebitdaMarginPct - base.ebitdaMarginPct) * 100,
      dcf: simulated.dcf - base.dcf,
      ev: simulated.ev - base.ev,
    },
  }
}
