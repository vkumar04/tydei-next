import { notFound } from "next/navigation"
import { requireVendor } from "@/lib/actions/auth"
import { getVendorContractDetail } from "@/lib/actions/vendor-contracts"
import { VendorContractDetailClient } from "./vendor-contract-detail-client"

interface Props {
  params: Promise<{ id: string }>
}

export default async function VendorContractDetailPage({ params }: Props) {
  const { vendor } = await requireVendor()
  const { id } = await params

  // `getVendorContractDetail` uses findUniqueOrThrow, which raises
  // P2025 on miss. Translate to a clean 404 here so an unknown id
  // doesn't dump a Prisma stack into the dev log.
  let contract: Awaited<ReturnType<typeof getVendorContractDetail>>
  try {
    contract = await getVendorContractDetail(id, vendor.id)
  } catch (err) {
    const code = (err as { code?: string } | null)?.code
    if (code === "P2025") notFound()
    throw err
  }

  return <VendorContractDetailClient contract={contract} />
}
