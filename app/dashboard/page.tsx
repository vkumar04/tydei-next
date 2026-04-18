/**
 * Facility dashboard — server component entry.
 *
 * Fetches the three composite payloads in parallel via the dashboard-
 * rewrite server actions and passes the snapshot to the client
 * orchestrator for hydration + subsequent TanStack Query refetches.
 *
 * Reference: docs/superpowers/specs/2026-04-18-facility-dashboard-rewrite.md
 */

import { Suspense } from "react"
import { requireFacility } from "@/lib/actions/auth"
import { getDashboardKPISummary } from "@/lib/actions/dashboard/kpi"
import { getDashboardCharts } from "@/lib/actions/dashboard/lifecycle"
import { getContractStats } from "@/lib/actions/contracts"
import {
  DashboardClient,
  type DashboardInitialData,
} from "@/components/facility/dashboard/dashboard-client"
import DashboardLoading from "./loading"

const CHART_MONTHS = 12

async function DashboardShell() {
  const { facility } = await requireFacility()

  // Fetch all three composite payloads in parallel — each action has
  // its own `requireFacility()` guard internally, but they share the
  // same session so the auth overhead is negligible.
  const [kpiSummary, charts, contractStats] = await Promise.all([
    getDashboardKPISummary(),
    getDashboardCharts({ months: CHART_MONTHS }),
    getContractStats(),
  ])

  const initialData: DashboardInitialData = {
    kpiSummary,
    charts,
    contractStats,
  }

  return (
    <DashboardClient
      facilityId={facility.id}
      initialData={initialData}
      chartMonths={CHART_MONTHS}
    />
  )
}

export default function FacilityDashboardPage() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardShell />
    </Suspense>
  )
}
