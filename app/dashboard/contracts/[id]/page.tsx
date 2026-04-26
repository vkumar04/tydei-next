import { notFound } from "next/navigation"
import { requireFacility } from "@/lib/actions/auth"
import { getContract } from "@/lib/actions/contracts"
import { getContractPerformanceBundle } from "@/lib/actions/analytics/contract-performance-bundle"
import { ContractDetailClient } from "@/components/contracts/contract-detail-client"

/**
 * Server component wrapper for the contract-detail page.
 *
 * W2.A.5 — pre-fetch the contract server-side and thread it through
 * as `initialContract` so React Query hydrates on first render with
 * the real values (no flicker, no ambiguous zeros).
 *
 * 2026-04-26 perf pass: also pre-fetch the Performance-tab analytics
 * bundle (composite score / renewal risk / rebate forecast / tie-in
 * compliance when applicable). Performance tab open used to fire 4-6
 * sequential server actions; now it pays one server-side bundle and
 * seeds React Query so the tab paints from cache. React's `cache()`
 * wrapper on `requireContractScope` dedupes the inner ownership
 * checks across the four sub-actions.
 */
export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireFacility()

  let initialContract: Awaited<ReturnType<typeof getContract>> | null = null
  try {
    initialContract = await getContract(id)
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === "P2025") notFound()
    throw err
  }
  if (!initialContract) notFound()

  // Best-effort pre-fetch of the Performance-tab bundle. If it fails
  // (data missing on a stub contract, etc.) we don't 404 the whole
  // page — let the client-side useQuery retry surface the error.
  let initialPerformanceBundle: Awaited<
    ReturnType<typeof getContractPerformanceBundle>
  > | null = null
  try {
    initialPerformanceBundle = await getContractPerformanceBundle(id)
  } catch (err) {
    console.warn("[contract-detail] performance bundle prefetch failed", err)
  }

  return (
    <ContractDetailClient
      contractId={id}
      initialContract={initialContract}
      initialPerformanceBundle={initialPerformanceBundle ?? undefined}
    />
  )
}
