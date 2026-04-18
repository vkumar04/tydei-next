import { requireFacility } from "@/lib/actions/auth"
import { getVendors } from "@/lib/actions/vendors"
import { ProspectiveClient } from "@/components/facility/analysis/prospective/prospective-client"

interface ProspectivePageProps {
  searchParams?: Promise<{ compare?: string; vendor?: string; tab?: string }>
}

/**
 * Prospective analysis page — server component shell.
 *
 * Responsibilities:
 *   - Auth: require facility session
 *   - Seed the orchestrator with facility id + vendor list (for vendor-bound
 *     spend-pattern + pricing-file lookups)
 *   - Forward URL params (compare / vendor / tab) so the client can hydrate
 *     the correct initial state without a round-trip
 */
export default async function ProspectivePage({
  searchParams,
}: ProspectivePageProps) {
  const { facility } = await requireFacility()
  const params = (await searchParams) ?? {}
  const vendors = await getVendors()

  return (
    <ProspectiveClient
      facilityId={facility.id}
      vendors={vendors}
      initialCompareId={params.compare ?? null}
      initialVendorId={params.vendor ?? null}
      initialTab={params.tab ?? null}
    />
  )
}
