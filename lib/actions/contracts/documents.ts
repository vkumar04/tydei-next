"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { logAudit } from "@/lib/audit"
import { serialize } from "@/lib/serialize"
import type { Prisma, DocumentType } from "@/lib/generated/prisma/client"

export interface CreateContractDocumentInput {
  contractId: string
  name: string
  url: string
  type?: string
  effectiveDate?: string | null
  size?: number | null
}

const VALID_DOC_TYPES: ReadonlySet<DocumentType> = new Set<DocumentType>([
  "main",
  "amendment",
  "addendum",
  "exhibit",
  "pricing",
])

function coerceDocType(value: string | undefined): DocumentType {
  if (value && (VALID_DOC_TYPES as Set<string>).has(value)) {
    return value as DocumentType
  }
  return "main"
}

export async function createContractDocument(
  input: CreateContractDocumentInput,
) {
  const { facility, user } = await requireFacility()
  await requireCanMutate()

  // `url` must be a storage object key, never an absolute URL — the
  // Documents tab turns it into a navigation target, so a stored URL would
  // be an open door for planted phishing links dressed as contract PDFs.
  if (/^[a-z][a-z0-9+.-]*:/i.test(input.url)) {
    throw new Error("Document url must be a storage key, not a URL")
  }

  // Ownership gate — throws if the contract isn't on this facility (primary
  // or via join table). `facilityId` is kept as a top-level predicate so
  // Prisma can narrow on the primary owner in addition to the OR fallback.
  const ownershipWhere: Prisma.ContractWhereUniqueInput = {
    ...contractOwnershipWhere(input.contractId, facility.id),
    facilityId: facility.id,
  }
  await prisma.contract.findUniqueOrThrow({
    where: ownershipWhere,
    select: { id: true },
  })

  const docType = coerceDocType(input.type)

  const doc = await prisma.contractDocument.create({
    data: {
      contractId: input.contractId,
      name: input.name,
      url: input.url,
      type: docType,
      effectiveDate: input.effectiveDate
        ? new Date(input.effectiveDate)
        : null,
      size: input.size ?? null,
    },
  })

  await logAudit({
    userId: user.id,
    action: "contract.document_uploaded",
    entityType: "contract_document",
    entityId: doc.id,
    metadata: {
      contractId: input.contractId,
      name: input.name,
      type: doc.type,
    },
  })

  revalidatePath(`/dashboard/contracts/${input.contractId}`)

  return serialize(doc)
}
