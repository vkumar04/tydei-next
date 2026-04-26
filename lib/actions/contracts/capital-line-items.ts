"use server"

/**
 * Charles audit suggestion #4 (v0-port): per-asset capital line item
 * server actions. CRUD on `ContractCapitalLineItem` for the multi-
 * item tie-in flow that mirrors v0's `LeasedServiceItem[]` shape.
 *
 * Auth pattern: every mutation gates by facility ownership of the
 * parent contract via contractOwnershipWhere. The auth-scope
 * scanner test verifies this.
 */

import { z } from "zod"
import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { contractOwnershipWhere } from "@/lib/actions/contracts-auth"
import { serialize } from "@/lib/serialize"

const lineItemInputSchema = z.object({
  description: z.string().min(1, "Description required"),
  itemNumber: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  contractTotal: z.number().min(0),
  initialSales: z.number().min(0).default(0),
  interestRate: z.number().min(0).max(1).nullable().optional(),
  termMonths: z.number().int().min(0).nullable().optional(),
  paymentType: z.enum(["fixed", "variable"]).default("fixed"),
  paymentCadence: z.enum(["monthly", "quarterly", "annual"]).default("monthly"),
})

export type CapitalLineItemInput = z.infer<typeof lineItemInputSchema>

/** List items for a contract (read). */
export async function getCapitalLineItems(contractId: string) {
  const { facility } = await requireFacility()
  await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  const rows = await prisma.contractCapitalLineItem.findMany({
    where: { contractId },
    orderBy: { createdAt: "asc" },
  })
  return serialize(rows)
}

/** Create a new line item on a contract. */
export async function createCapitalLineItem(
  contractId: string,
  input: CapitalLineItemInput,
) {
  const { facility } = await requireFacility()
  await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(contractId, facility.id),
    select: { id: true },
  })
  const data = lineItemInputSchema.parse(input)
  const row = await prisma.contractCapitalLineItem.create({
    data: {
      contractId,
      description: data.description,
      itemNumber: data.itemNumber ?? null,
      serialNumber: data.serialNumber ?? null,
      contractTotal: new Prisma.Decimal(data.contractTotal),
      initialSales: new Prisma.Decimal(data.initialSales),
      interestRate:
        data.interestRate != null
          ? new Prisma.Decimal(data.interestRate)
          : null,
      termMonths: data.termMonths ?? null,
      paymentType: data.paymentType,
      paymentCadence: data.paymentCadence,
    },
  })
  return serialize(row)
}

/** Update an existing line item. */
export async function updateCapitalLineItem(
  itemId: string,
  input: Partial<CapitalLineItemInput>,
) {
  const { facility } = await requireFacility()
  // Resolve parent contract through the row to verify ownership.
  const existing = await prisma.contractCapitalLineItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { contractId: true },
  })
  await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(existing.contractId, facility.id),
    select: { id: true },
  })
  const data = lineItemInputSchema.partial().parse(input)
  const row = await prisma.contractCapitalLineItem.update({
    where: { id: itemId },
    data: {
      ...(data.description !== undefined && { description: data.description }),
      ...(data.itemNumber !== undefined && {
        itemNumber: data.itemNumber ?? null,
      }),
      ...(data.serialNumber !== undefined && {
        serialNumber: data.serialNumber ?? null,
      }),
      ...(data.contractTotal !== undefined && {
        contractTotal: new Prisma.Decimal(data.contractTotal),
      }),
      ...(data.initialSales !== undefined && {
        initialSales: new Prisma.Decimal(data.initialSales),
      }),
      ...(data.interestRate !== undefined && {
        interestRate:
          data.interestRate != null
            ? new Prisma.Decimal(data.interestRate)
            : null,
      }),
      ...(data.termMonths !== undefined && {
        termMonths: data.termMonths ?? null,
      }),
      ...(data.paymentType !== undefined && { paymentType: data.paymentType }),
      ...(data.paymentCadence !== undefined && {
        paymentCadence: data.paymentCadence,
      }),
    },
  })
  return serialize(row)
}

/** Delete a line item. */
export async function deleteCapitalLineItem(itemId: string) {
  const { facility } = await requireFacility()
  const existing = await prisma.contractCapitalLineItem.findUniqueOrThrow({
    where: { id: itemId },
    select: { contractId: true },
  })
  await prisma.contract.findFirstOrThrow({
    where: contractOwnershipWhere(existing.contractId, facility.id),
    select: { id: true },
  })
  await prisma.contractCapitalLineItem.delete({ where: { id: itemId } })
}
