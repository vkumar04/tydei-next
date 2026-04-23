import { notFound } from "next/navigation"
import { requireFacility } from "@/lib/actions/auth"
import { getContract } from "@/lib/actions/contracts"
import { ContractDetailClient } from "@/components/contracts/contract-detail-client"

/**
 * Server component wrapper for the contract-detail page.
 *
 * W2.A.5 — the client used to render the header-card grid from the
 * `useContract` query in isolation, so on every navigation users saw
 * a brief "$0" / loading-skeleton flash for the "Current Spend (Last
 * 12 Months)" card before the client-side fetch resolved. Pre-fetch
 * the contract server-side and thread it through as `initialContract`
 * so React Query hydrates on first render with the real values (no
 * flicker, no ambiguous zeros). This mirrors the pattern used by the
 * facility dashboard — see `components/facility/dashboard/dashboard-client.tsx`.
 */
export default async function ContractDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  await requireFacility()

  // Contract ownership is enforced inside `getContract` via
  // `contractOwnershipWhere` + `findUniqueOrThrow`. When the id is bogus
  // the Prisma call throws P2025 — translate that to a 404. Other
  // errors still bubble up so the error boundary surfaces them.
  let initialContract: Awaited<ReturnType<typeof getContract>> | null = null
  try {
    initialContract = await getContract(id)
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === "P2025") {
      notFound()
    }
    throw err
  }
  if (!initialContract) notFound()

  return (
    <ContractDetailClient contractId={id} initialContract={initialContract} />
  )
}
