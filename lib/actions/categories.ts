"use server"

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import type { ProductCategory } from "@prisma/client"

// ─── Types ──────────────────────────────────────────────────────

export interface CategoryNode extends ProductCategory {
  children: CategoryNode[]
}

// ─── List Categories (flat - for dropdowns) ─────────────────────

export async function getCategories() {
  await requireFacility()

  return prisma.productCategory.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
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

  return roots
}

// ─── Create Category ────────────────────────────────────────────

export async function createCategory(input: {
  name: string
  description?: string
  parentId?: string
}) {
  await requireFacility()

  return prisma.productCategory.create({
    data: {
      name: input.name,
      description: input.description,
      parentId: input.parentId,
    },
  })
}

// ─── Update Category ────────────────────────────────────────────

export async function updateCategory(
  id: string,
  input: { name?: string; description?: string; parentId?: string | null }
) {
  await requireFacility()

  return prisma.productCategory.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.parentId !== undefined && { parentId: input.parentId }),
    },
  })
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

  return prisma.categoryMapping.findMany({
    orderBy: { createdAt: "desc" },
  })
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
