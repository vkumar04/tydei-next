"use server"

import { prisma } from "@/lib/db"
import { requireAdmin, requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import {
  vendorFiltersSchema,
  createVendorSchema,
  updateVendorSchema,
  VENDOR_PAGE_SIZE,
  type VendorFilters,
  type CreateVendorInput,
  type UpdateVendorInput,
} from "@/lib/validators/vendors"
import type { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"

// ─── List Vendors (simple - for dropdowns) ──────────────────────

export async function getVendors() {
  await requireFacility()

  // Return all non-inactive vendors so newly-auto-created vendors from COG
  // imports appear without requiring explicit status activation.
  const vendors = await prisma.vendor.findMany({
    where: { status: { not: "inactive" } },
    select: { id: true, name: true, displayName: true },
    orderBy: { name: "asc" },
  })
  return serialize(vendors)
}

// ─── List Vendors (full with filters) ───────────────────────────

/**
 * One page of vendors, plus the counts that describe the page's own scope.
 *
 * Every number returned here is server-computed over the SAME `where` the rows
 * came from, so a caller can never derive a total from `vendors.length`:
 *
 *   - `vendors`     — the requested page only
 *   - `total`       — rows matching the active filters, across ALL pages
 *   - `catalogTotal`— rows the SEARCH ran over: every active filter except the
 *                     search itself. With no status filter that is the whole
 *                     catalog; with one it is that status's rows, so a label
 *                     like "searched all N vendors" names the scope actually
 *                     searched instead of the widest number to hand.
 *   - `page`        — the page actually served (clamped into range)
 *   - `pageCount`   — how many pages `total` spans at this `pageSize`
 *   - `search`      — the search these counts were computed under, echoed back
 *                     so a label can never describe a filter the rows aren't in
 *
 * `page` is clamped rather than trusted: deactivating rows or narrowing a
 * search shrinks `total`, and a stale page number would otherwise render an
 * empty table that looks like "no vendors" instead of "you ran off the end".
 * Callers must render `page`/`pageCount` from THIS response, not from their own
 * state, so the label beside the rows always describes the rows beside it.
 */
export async function getVendorList(input: VendorFilters) {
  await requireFacility()
  const filters = vendorFiltersSchema.parse(input)

  const search = filters.search?.trim() ?? ""

  // The filters the search runs INSIDE, kept separate from the search itself so
  // the two counts below are each attributable to one scope. Fold them together
  // and `catalogTotal` silently becomes "every vendor that exists", which is a
  // wider claim than the sentence beside it ("searched all N vendors") makes.
  const baseConditions: Prisma.VendorWhereInput[] = []
  if (filters.status) baseConditions.push({ status: filters.status })

  // Search runs in Postgres over the whole catalog — never over the page the
  // client happens to be holding, which is the entire point of paging here.
  const searchCondition: Prisma.VendorWhereInput | null = search
    ? {
        OR: [
          { name: { contains: search, mode: "insensitive" } },
          { code: { contains: search, mode: "insensitive" } },
          { displayName: { contains: search, mode: "insensitive" } },
        ],
      }
    : null

  const conditions = searchCondition
    ? [...baseConditions, searchCondition]
    : baseConditions
  const where: Prisma.VendorWhereInput =
    conditions.length > 0 ? { AND: conditions } : {}
  const searchScopeWhere: Prisma.VendorWhereInput =
    baseConditions.length > 0 ? { AND: baseConditions } : {}
  const pageSize = filters.pageSize ?? VENDOR_PAGE_SIZE

  const [total, searchScopeTotal] = await Promise.all([
    prisma.vendor.count({ where }),
    // Only a second round trip when a search narrows the rows; without one the
    // two scopes are the same number by definition.
    searchCondition ? prisma.vendor.count({ where: searchScopeWhere }) : undefined,
  ])
  const catalogTotal = searchScopeTotal ?? total

  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(Math.max(filters.page ?? 1, 1), pageCount)

  const vendors = await prisma.vendor.findMany({
    where,
    orderBy: { name: "asc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  })

  return serialize({
    vendors,
    total,
    catalogTotal,
    page,
    pageSize,
    pageCount,
    search,
  })
}

// ─── Single Vendor ──────────────────────────────────────────────

export async function getVendor(id: string) {
  await requireFacility()

  // Vendor carries no owning-tenant column (prisma/schema.prisma) — it is one
  // shared catalog row, which is why every mutation below is admin-gated
  // instead of facility-scoped. This exemption is not new: it was the
  // line-number baseline entry "lib/actions/vendors.ts:74" in
  // server-action-auth-scope-scanner.test.ts, which the pagination fix above
  // shifted. Restated as a marker so it survives line drift.
  // auth-scope-scanner-skip: read-only by id on an untenanted catalog row.
  const vendor = await prisma.vendor.findUniqueOrThrow({
    where: { id },
    include: { divisions: true, childVendors: true },
  })
  return serialize(vendor)
}

// ─── Create Vendor ──────────────────────────────────────────────

/**
 * `Vendor.name` carries no unique constraint (prisma/schema.prisma), and an
 * "Add Vendor" button sits directly above the vendor table. When that table was
 * silently truncated, the reliable way to "not find" Stryker was to scroll a
 * list that stopped at rank 100 — and the next click was Add Vendor, which
 * minted a SECOND Stryker row and split its COG matching across two vendor ids.
 * Pagination stops manufacturing that; this guard stops the last mile of it, by
 * refusing an exact (case-insensitive) collision on name or display name and
 * naming the row that already exists. Matching stays exact on purpose — merging
 * genuinely different companies is a financial error, not a reporting gap
 * (see lib/vendors/normalize.ts).
 */
export async function createVendor(input: CreateVendorInput) {
  await requireFacility()
  await requireCanMutate()
  const parsed = createVendorSchema.parse(input)
  const data = {
    ...parsed,
    name: parsed.name.trim(),
    // Trim what we COMPARE and what we STORE identically: storing " Stryker "
    // after comparing "Stryker" would let the next attempt through, since the
    // stored value no longer equals its own trimmed form.
    displayName: parsed.displayName?.trim() || undefined,
  }

  // A vendor is recognised by either column, so check both candidate values
  // against both columns — a new row whose displayName matches an existing
  // vendor is the same duplicate, just entered in the other box.
  // Narrowed deliberately: a Prisma `equals: undefined` is "no filter at all",
  // which inside this OR would match the first vendor in the table and refuse
  // every create.
  const candidates = [
    ...new Set(
      [data.name, data.displayName].filter((v): v is string => Boolean(v)),
    ),
  ]
  const collisions: Prisma.VendorWhereInput[] = candidates.flatMap((value) => [
    { name: { equals: value, mode: "insensitive" } },
    { displayName: { equals: value, mode: "insensitive" } },
  ])
  const existing = await prisma.vendor.findFirst({
    where: { OR: collisions },
    select: { id: true, name: true, displayName: true, status: true },
  })
  if (existing) {
    throw new Error(
      `A vendor named "${existing.name}"${
        existing.displayName ? ` (display name "${existing.displayName}")` : ""
      } already exists${
        existing.status === "inactive" ? " (currently inactive)" : ""
      } — search for it in the vendor list instead of adding a duplicate.`,
    )
  }

  const vendor = await prisma.vendor.create({
    data: {
      name: data.name,
      code: data.code,
      displayName: data.displayName,
      division: data.division,
      contactName: data.contactName,
      contactEmail: data.contactEmail || null,
      contactPhone: data.contactPhone,
      website: data.website || null,
      address: data.address,
      tier: data.tier,
    },
  })
  return serialize(vendor)
}

// ─── Update Vendor ──────────────────────────────────────────────

export async function updateVendor(id: string, input: UpdateVendorInput) {
  // Charles audit deferred-fix: Vendor rows are shared across
  // facilities, so mutation must be admin-gated. A facility user
  // changing another vendor's contact info or division would
  // silently affect every other tenant's view of that vendor.
  await requireAdmin()
  const data = updateVendorSchema.parse(input)

  const vendor = await prisma.vendor.update({
    where: { id },
    data: {
      ...(data.name !== undefined && { name: data.name }),
      ...(data.code !== undefined && { code: data.code }),
      ...(data.displayName !== undefined && { displayName: data.displayName }),
      ...(data.division !== undefined && { division: data.division }),
      ...(data.contactName !== undefined && { contactName: data.contactName }),
      ...(data.contactEmail !== undefined && {
        contactEmail: data.contactEmail || null,
      }),
      ...(data.contactPhone !== undefined && {
        contactPhone: data.contactPhone,
      }),
      ...(data.website !== undefined && { website: data.website || null }),
      ...(data.address !== undefined && { address: data.address }),
      ...(data.tier !== undefined && { tier: data.tier }),
    },
  })
  return serialize(vendor)
}

// ─── Deactivate Vendor ──────────────────────────────────────────

export async function deactivateVendor(id: string) {
  // Charles audit deferred-fix: deactivating a vendor affects every
  // facility that has a connection to it — admin-only.
  await requireAdmin()

  await prisma.vendor.update({
    where: { id },
    data: { status: "inactive" },
  })
}
