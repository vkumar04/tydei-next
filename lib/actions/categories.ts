"use server"

import { prisma } from "@/lib/db"
import { requireAdmin, requireAuth, requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import type { ProductCategory } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { removeInverseCategoryMapping } from "@/lib/categories/resolve"
import { mappedCategoryUniverse } from "@/lib/contracts/mapped-category-universe"

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

export async function getCategories(opts?: { includeSuperseded?: boolean }) {
  await requireAuth()

  const categories = await prisma.productCategory.findMany({
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  })
  // bugs.rtfd 2026-06-14 ("Ortho-Joints is not on the list anymore"): the
  // Realign "Map to" dropdown is a TARGET picker — the user is choosing which
  // canonical name to map a detected category INTO, so it must offer every
  // category, including ones that are themselves the source of a confirmed
  // mapping (e.g. Ortho-Joints, mapped to Joints-Ortho). Callers that want the
  // de-cluttered list (term pickers) omit the flag and keep hiding superseded
  // sources.
  if (opts?.includeSuperseded) {
    return serialize(categories)
  }
  // Charles 2026-06-10 ("the categories here should reflect the names of
  // what was mapped not what was on the price file"): a name that is the
  // SOURCE of a confirmed mapping is superseded — remapCOGCategory deletes
  // its taxonomy row only when nothing references it anymore, so it can
  // linger here and reappear in every term/category picker. Hide it from
  // option lists — but ONLY when the mapping target exists as a pickable
  // row (review F9: when the target has no taxonomy row, remap could not
  // retarget the contract's categoryIds, so hiding the source would strand
  // an invisible, unremovable selection in the pickers).
  const confirmedSources = await prisma.categoryMapping.findMany({
    where: { isConfirmed: true, contractCategory: { not: null } },
    select: { cogCategory: true, contractCategory: true },
  })
  const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ")
  const presentNames = new Set(categories.map((c) => normKey(c.name)))
  const superseded = new Set(
    confirmedSources
      .filter(
        (m) => m.contractCategory && presentNames.has(normKey(m.contractCategory)),
      )
      .map((m) => normKey(m.cogCategory)),
  )
  return serialize(
    categories.filter((c) => !superseded.has(normKey(c.name))),
  )
}

// ─── Mapped-category universe (for the term picker) ─────────────
//
// bugs.rtfd 2026-06-13 ("no categories to choose ... won't let me use
// Ortho-extremity"): the new/edit contract pages used to pass the
// mapped-category universe as a server-rendered PROP computed at page load.
// After the prod wipe, pages loaded while the DB was empty froze that prop at
// `[]` and never recovered — so the term picker stayed empty even once the
// user re-uploaded a price file. Exposing it as a live action lets the client
// refetch (and invalidate after a price-file import) so it stays current.
export async function getMappedCategoryUniverse(): Promise<string[]> {
  const { facility } = await requireFacility()
  return mappedCategoryUniverse(facility.id)
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
  await requireCanMutate()

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
  // Charles audit deferred-fix: ProductCategory is a global taxonomy
  // (no facilityId column). Renaming or reparenting a category
  // affects every tenant's dropdowns and category-scoped contracts.
  // Admin-only. createCategory stays facility-accessible because
  // facility workflows need to add new categories ad-hoc.
  await requireAdmin()

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
  // Charles audit deferred-fix: deleting a category orphans every
  // contract that scopes a term by it. Admin-only.
  await requireAdmin()

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
  await requireCanMutate()

  const row = await prisma.categoryMapping.update({
    where: { id },
    data: { contractCategory, isConfirmed: true },
    select: { cogCategory: true },
  })
  // 2026-06-09 audit: drop any confirmed inverse (to→from) so a swap cycle
  // can never form — see removeInverseCategoryMapping.
  await removeInverseCategoryMapping(row.cogCategory, contractCategory)
}
