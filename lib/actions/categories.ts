"use server"

import { prisma } from "@/lib/db"
import { requireAuth, requireFacility } from "@/lib/actions/auth"
import type { ProductCategory } from "@prisma/client"
import { serialize } from "@/lib/serialize"

// ─── Types ──────────────────────────────────────────────────────

export interface CategoryNode extends ProductCategory {
  children: CategoryNode[]
}

// ─── List Categories (flat - for dropdowns) ─────────────────────
//
// Shared across every portal (facility + vendor + admin contract
// forms). Gating this on requireFacility() meant ANY vendor screen
// that mounted <ContractTermsEntry> silently redirected to
// /vendor/dashboard — Charles's recurring "contracts/new bounces
// me out" bug. ProductCategory rows are global, not
// facility-scoped, so authenticated is enough.

export async function getCategories() {
  await requireAuth()

  const categories = await prisma.productCategory.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  return serialize(categories)
}

// ─── Get Category Tree ──────────────────────────────────────────

export async function getCategoryTree(): Promise<CategoryNode[]> {
  await requireFacility()

  const categories = await prisma.productCategory.findMany({
    orderBy: { name: "asc" },
  })

  const categoryMap = new Map<string, CategoryNode>()
  const roots: CategoryNode[] = []

  for (const cat of categories) {
    categoryMap.set(cat.id, { ...cat, children: [] })
  }

  for (const cat of categories) {
    const node = categoryMap.get(cat.id)!
    if (cat.parentId) {
      const parent = categoryMap.get(cat.parentId)
      if (parent) {
        parent.children.push(node)
      } else {
        roots.push(node)
      }
    } else {
      roots.push(node)
    }
  }

  return serialize(roots)
}

// ─── Create Category ────────────────────────────────────────────

export async function createCategory(input: {
  name: string
  description?: string
  parentId?: string
}) {
  await requireFacility()

  const category = await prisma.productCategory.create({
    data: {
      name: input.name,
      description: input.description,
      parentId: input.parentId,
    },
  })
  return serialize(category)
}

// ─── Update Category ────────────────────────────────────────────

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string; parentId?: string | null }
) {
  await requireFacility()

  const category = await prisma.productCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
    },
  })
  return serialize(category)
}

// ─── Delete Category ────────────────────────────────────────────

export async function deleteCategory(id: string) {
  await requireFacility()

  // Re-parent children to null before deleting
  await prisma.productCategory.updateMany({
    where: { parentId: id },
    data: { parentId: null },
  })

  await prisma.productCategory.delete({ where: { id } })
}

// ─── Category Mappings ──────────────────────────────────────────

export async function getCategoryMappings() {
  await requireFacility()

  const mappings = await prisma.categoryMapping.findMany({
    orderBy: { createdAt: "desc" },
  })
  return serialize(mappings)
}

export async function confirmCategoryMapping(
  id: string,
  contractCategory: string
) {
  await requireFacility()

  await prisma.categoryMapping.update({
    where: { id },
    data: { contractCategory, isConfirmed: true },
  })
}
