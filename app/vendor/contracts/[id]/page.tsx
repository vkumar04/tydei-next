import { notFound } from "next/navigation"
import { requireVendor } from "@/lib/actions/auth"
import { getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import { getContractPerformanceBundle } from "@/lib/actions/analytics/contract-performance-bundle"
import { VendorContractDetailClient } from "./vendor-contract-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

export default async function VendorContractDetailPage({ params }: Props) {
  const { vendor } = await requireVendor()
  const { id } = await params

  let contract: Awaited<ReturnType<typeof getVendorContractDetail>>
  try {
    contract = await getVendorContractDetail(id, vendor.id)
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === "P2025") notFound()
    throw err
  }

  // 2026-04-26 perf pass: bundled Performance-tab analytics prefetch
  // (mirrors the facility wrapper). React `cache()` on
  // requireContractScope dedupes the inner ownership checks.
  let initialPerformanceBundle: Awaited<
    ReturnType<typeof getContractPerformanceBundle>
  > | null = null
  try {
    initialPerformanceBundle = await getContractPerformanceBundle(id)
  } catch (err) {
    console.warn("[vendor-contract-detail] performance bundle prefetch failed", err)
  }

  return (
    <VendorContractDetailClient
      contract={contract}
      initialPerformanceBundle={initialPerformanceBundle ?? undefined}
    />
  )
}
