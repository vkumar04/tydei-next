/**
 * GET /api/ai/documents
 *
 * Lists `ContractDocument` rows for contracts owned by or shared with
 * the caller's facility. Returns AI-indexing metadata (indexStatus,
 * indexedAt, page count) so the Documents tab can render badges + row
 * counts without a second roundtrip.
 *
 * This is UI-only scope — we don't edit `lib/actions/ai/*`, so the
 * fetch lives here with facility-scoped prisma queries.
 */
import { headers } from "next/headers"
import { prisma } from "@/lib/db"
import { auth } from "@/lib/auth-server"
import { contractsOwnedByFacility } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

export interface AiDocumentListItem {
  id: string
  name: string
  type: string
  uploadDate: string
  indexStatus: string
  indexedAt: string | null
  pageCount: number
  contractId: string
  contractName: string
  vendorName: string
}

export async function GET() {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const member = await prisma.member.findFirst({
    where: { userId: session.user.id },
    include: { organization: { include: { facility: true } } },
  })
  const facility = member?.organization?.facility
  if (!facility) {
    return Response.json({ error: "No active facility" }, { status: 403 })
  }

  const docs = await prisma.contractDocument.findMany({
    where: { contract: contractsOwnedByFacility(facility.id) },
    orderBy: { uploadDate: "desc" },
    include: {
      contract: {
        select: {
          id: true,
          name: true,
          vendor: { select: { name: true } },
        },
      },
      _count: { select: { pages: true } },
    },
  })

  const items: AiDocumentListItem[] = docs.map((d) => ({
    id: d.id,
    name: d.name,
    type: String(d.type),
    uploadDate: d.uploadDate.toISOString(),
    indexStatus: d.indexStatus,
    indexedAt: d.indexedAt ? d.indexedAt.toISOString() : null,
    pageCount: d._count.pages,
    contractId: d.contract.id,
    contractName: d.contract.name,
    vendorName: d.contract.vendor.name,
  }))

  return Response.json(serialize({ documents: items }))
}
