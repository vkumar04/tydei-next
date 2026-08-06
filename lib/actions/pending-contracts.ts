"use server"

import { ZodError } from "zod"
import { prisma } from "@/lib/db"
import type { Prisma, PendingContract } from "@/lib/generated/prisma/client"
import { requireVendor, requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import {
  resolveOperatingMode,
  canAutoActivate,
} from "@/lib/connections/operating-mode"
import {
  createPendingContractSchema,
  updatePendingContractSchema,
  type CreatePendingContractInput,
  type UpdatePendingContractInput,
} from "@/lib/validators/pending-contracts"
import { serialize } from "@/lib/serialize"
import { keyBelongsToTenant } from "@/lib/uploads/key-policy"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import {
  extractPendingPricingItems,
  extractPendingTerms,
  buildCapitalLineItemsFromPending,
} from "@/lib/contracts/pending-extract"
import {
  notifyFacilityOfPendingContract,
  notifyVendorOfPendingDecision,
} from "@/lib/actions/notifications"
import { excludeProspectiveProposalRows } from "@/lib/prospective/proposal-rows"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"

// The pure JSON extractors (coerceNumber / coerceString / parseDateOr,
// extractPendingPricingItems, buildCapitalLineItemsFromPending,
// extractPendingTerms) live in lib/contracts/pending-extract.ts — a
// directive-free module, because a "use server" file may only export
// async functions and every export here becomes a client-callable action.

// ─── Internal: materialize a submission into a live Contract ────

/**
 * Turn a `submitted` PendingContract into a real Contract row (terms, tiers,
 * pricing, documents, category links) and flip the pending row to `approved`.
 *
 * Charles 2026-07-27: extracted verbatim out of `approvePendingContract` so
 * the one-way auto-activation branch in `createPendingContract` runs the
 * SAME materialization — "if it is set up for 1 way on a facility it does not
 * need to submit a contract it just becomes active after creating it". Two
 * parallel hand-rolled materializers would drift exactly like the parallel
 * reducers CLAUDE.md warns about; there is one.
 *
 * LOCAL AND NON-EXPORTED ON PURPOSE. This file is `"use server"`, so any
 * export here becomes a client-callable Server Action — a directly-invocable
 * `materializePending(pendingId, ...)` would be an unauthenticated
 * "make any submission live" RPC, bypassing every auth gate. Callers do the
 * gating: `approvePendingContract` (requireFacility + requireCanMutate +
 * facility-scoped read) and `createPendingContract` (requireVendor +
 * requireCanMutate + `canAutoActivate`).
 *
 * `facilityId` is NULLABLE: a standalone one-way vendor's own contract has no
 * counterparty facility. When it is null the COG match recompute and the
 * facility-side revalidations are skipped — there is no facility whose rows
 * or cached views could change.
 */
async function materializePending(
  pending: PendingContract,
  facilityId: string | null,
  reviewedBy: string,
) {
  // 2026-06-09 audit: only a "submitted" row is approvable. Without this
  // guard, re-approving an already-approved (or rejected/withdrawn) row
  // created a DUPLICATE Contract — prod had 7 approved rows whose contracts
  // were later deleted, each one re-approve away from a dupe.
  if (pending.status !== "submitted") {
    throw new Error(
      `This submission is "${pending.status}" — only submitted contracts can be approved.` +
        (pending.status === "approved"
          ? " It was already approved; ask the vendor to resubmit if a new contract is needed."
          : " Ask the vendor to (re)submit it."),
    )
  }

  // F3 — port pricingData JSON into ContractPricing rows. Defensively
  // extract only items that look real (vendorItemNo + numeric unitPrice).
  const pricingItems = extractPendingPricingItems(pending.pricingData)

  // Charles 2026-04-25 (vendor-mirror Phase 1): port the `terms` JSON
  // blob into real `ContractTerm` + `ContractTier` rows. Without this
  // every approved vendor submission silently lost its rebate
  // structure — the contract appeared as "active" but had no terms,
  // so accruals computed to $0 forever. The shape of the blob mirrors
  // what the vendor submission form persists; we extract defensively
  // so a malformed blob doesn't blow the approval.
  const pendingTerms = extractPendingTerms(pending.terms, pending.effectiveDate)

  // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
  // pre-resolve scoped category IDs → names per term, OUTSIDE the
  // create call. ContractTerm.categories is a String[] of NAMES (the
  // engine matches against COG row category names) but the vendor UI
  // sends category IDs. Mirrors the create-contract path in
  // lib/actions/contracts.ts.
  const resolvedCategoryNamesByTerm = new Map<number, string[]>()
  for (let i = 0; i < pendingTerms.length; i++) {
    const ids = pendingTerms[i].scopedCategoryIds
    if (ids.length > 0) {
      resolvedCategoryNamesByTerm.set(i, await resolveCategoryIdsToNames(ids))
    }
  }

  // 2026-06-09 audit: the approval writes (contract + nested terms/tiers/
  // pricing, documents, category links, pending-row status flip) were
  // sequential — a mid-flight crash could create the Contract without
  // flipping the pending row (the status guard above makes that benign but
  // manual to clean up). Run them as ONE interactive transaction so an
  // approval either fully lands or fully rolls back. Timeout is generous
  // because pricing payloads can be large (one prod submission carries
  // ~46K ContractPricing rows in the nested create).
  const contract = await prisma.$transaction(
    async (tx) => {
      const contract = await tx.contract.create({
        data: {
          name: pending.contractName,
          vendorId: pending.vendorId,
          facilityId,
          contractType: pending.contractType,
          // 2026-06-09 audit: derive status from the expiration date instead of
          // hardcoding "active" — two prod rows (exp 2024-12-31) were approved
          // as "active" though already expired, violating the
          // status/expirationDate invariant.
          status:
            pending.expirationDate && pending.expirationDate < new Date()
              ? "expired"
              : "active",
          effectiveDate: pending.effectiveDate ?? new Date(),
          // Evergreen sentinel (see lib/actions/contracts.ts:728). Previously
          // the fallback was now + 365d which silently created a contract
          // that "expired" exactly one year after approval with no user
          // action. For evergreen pending contracts, write the far-future
          // sentinel so the matcher + formatDate treat it correctly
          // ("Evergreen" in the UI, in-window for every future COG row).
          expirationDate:
            pending.expirationDate ?? new Date(Date.UTC(9999, 11, 31)),
          totalValue: pending.totalValue ?? 0,
          // Charles 2026-04-25 (vendor-mirror Phase 2): port the field-
          // parity columns onto the real contract on approve. Without
          // this the vendor's submitted values would still drop on the
          // floor at the approve boundary even though Phase 2 added the
          // columns to PendingContract.
          ...(pending.contractNumber != null && {
            contractNumber: pending.contractNumber,
          }),
          ...(pending.annualValue != null && {
            annualValue: pending.annualValue,
          }),
          ...(pending.gpoAffiliation != null && {
            gpoAffiliation: pending.gpoAffiliation,
          }),
          // performancePeriod / rebatePayPeriod are typed `String?` on
          // PendingContract (free-form vendor input) but enums on the
          // real Contract. Cast at the boundary; if the vendor sent a
          // value that doesn't match the enum the create will throw and
          // surface a helpful Prisma error to the reviewer.
          ...(pending.performancePeriod != null && {
            performancePeriod:
              pending.performancePeriod as Prisma.ContractCreateInput["performancePeriod"],
          }),
          ...(pending.rebatePayPeriod != null && {
            rebatePayPeriod:
              pending.rebatePayPeriod as Prisma.ContractCreateInput["rebatePayPeriod"],
          }),
          autoRenewal: pending.autoRenewal,
          ...(pending.terminationNoticeDays != null && {
            terminationNoticeDays: pending.terminationNoticeDays,
          }),
          // Charles audit suggestion #4 (v0-port): drain capital from
          // pending → real ContractCapitalLineItem rows. Two sources:
          //   (a) pending.capitalLineItems JSON — vendor multi-item path.
          //   (b) Single-block pending.capitalCost — backward-compat for
          //       older clients that haven't adopted the editor yet.
          // (a) wins when present; (b) is a fallback so single-item
          // submissions keep working.
          ...(() => {
            const items = buildCapitalLineItemsFromPending(pending)
            return items.length > 0
              ? { capitalLineItems: { create: items } }
              : {}
          })(),
          // Charles audit pass-3 C1 + pass-4 BLOCKER 2: copy tie-in
          // parent + division so the capital amortization tie-in math is
          // wired post-approve. Field on Contract is
          // `tieInCapitalContractId` (not `tieInContractId` — that's the
          // PendingContract field name only).
          ...(pending.tieInContractId != null && {
            tieInCapitalContractId: pending.tieInContractId,
          }),
          ...(pending.division != null && { division: pending.division }),
          ...(pricingItems.length > 0 && {
            pricingItems: {
              create: pricingItems,
            },
          }),
          ...(pendingTerms.length > 0 && {
            terms: {
              // Prisma's nested-create requires enum-typed strings on the
              // term row. JSON-extracted values are bare strings, so we
              // cast at this single boundary. The validators in
              // `lib/validators/contract-terms.ts` would reject anything
              // unsafe upstream once Phase 2 plumbs validated terms
              // through the pending model.
              create: pendingTerms.map((t, idx) => {
                const resolvedCategoryNames = resolvedCategoryNamesByTerm.get(idx)
                return {
                  termName: t.termName,
                  termType:
                    t.termType as Prisma.ContractTermCreateInput["termType"],
                  baselineType:
                    t.baselineType as Prisma.ContractTermCreateInput["baselineType"],
                  evaluationPeriod: t.evaluationPeriod,
                  paymentTiming: t.paymentTiming,
                  appliesTo: t.appliesTo,
                  rebateMethod:
                    t.rebateMethod as Prisma.ContractTermCreateInput["rebateMethod"],
                  effectiveStart: t.effectiveStart,
                  effectiveEnd: t.effectiveEnd,
                  // Charles 2026-04-25 (vendor-mirror Phase 3 follow-up — B5):
                  // baseline + scope + procedure fields. Pre-fix these were
                  // dropped at the approve boundary; the engine then
                  // computed $0 forever against undefined baselines.
                  ...(t.spendBaseline != null && {
                    spendBaseline: t.spendBaseline,
                  }),
                  ...(t.growthBaselinePercent != null && {
                    growthBaselinePercent: t.growthBaselinePercent,
                  }),
                  // volumeBaseline is Int on the schema (Math.round so a
                  // string→number coercion of "5000.0" doesn't trip
                  // Prisma). desiredMarketShare is a Decimal — straight
                  // through.
                  ...(t.volumeBaseline != null && {
                    volumeBaseline: Math.round(t.volumeBaseline),
                  }),
                  ...(t.desiredMarketShare != null && {
                    desiredMarketShare: t.desiredMarketShare,
                  }),
                  ...(t.volumeType != null && {
                    volumeType:
                      t.volumeType as Prisma.ContractTermCreateInput["volumeType"],
                  }),
                  // ContractTerm.categories holds NAMES (resolved above).
                  ...(resolvedCategoryNames &&
                    resolvedCategoryNames.length > 0 && {
                      categories: resolvedCategoryNames,
                    }),
                  ...(t.cptCodes.length > 0 && { cptCodes: t.cptCodes }),
                  // scopedItemNumbers → ContractTermProduct join rows.
                  ...(t.scopedItemNumbers.length > 0 && {
                    products: {
                      create: t.scopedItemNumbers.map((vendorItemNo) => ({
                        vendorItemNo,
                      })),
                    },
                  }),
                  ...(t.tiers.length > 0 && {
                    tiers: {
                      create: t.tiers.map((tier) => ({
                        tierNumber: tier.tierNumber,
                        ...(tier.tierName != null && { tierName: tier.tierName }),
                        spendMin: tier.spendMin,
                        ...(tier.spendMax != null && { spendMax: tier.spendMax }),
                        // volumeMin/Max are Int columns — round at the
                        // boundary in case of string→number coercion.
                        ...(tier.volumeMin != null && {
                          volumeMin: Math.round(tier.volumeMin),
                        }),
                        ...(tier.volumeMax != null && {
                          volumeMax: Math.round(tier.volumeMax),
                        }),
                        ...(tier.marketShareMin != null && {
                          marketShareMin: tier.marketShareMin,
                        }),
                        ...(tier.marketShareMax != null && {
                          marketShareMax: tier.marketShareMax,
                        }),
                        rebateValue: tier.rebateValue,
                        rebateType:
                          tier.rebateType as Prisma.ContractTierCreateInput["rebateType"],
                      })),
                    },
                  }),
                }
              }),
            },
          }),
        },
      })

      // Charles 2026-04-26 (#59): copy vendor-attached PDFs from
      // PendingContract.documents (JSON array of {name, url}) into real
      // ContractDocument rows so the vendor's Documents tab on the
      // approved contract isn't empty. Without this, every approval
      // dropped the vendor-uploaded contract PDF on the floor.
      if (Array.isArray(pending.documents) && pending.documents.length > 0) {
        type AttachedDoc = { name?: unknown; url?: unknown; type?: unknown }
        const docs = (pending.documents as AttachedDoc[])
          .filter(
            (d): d is { name: string; url: string; type?: string } =>
              d != null &&
              typeof d === "object" &&
              typeof (d as AttachedDoc).url === "string" &&
              // Storage keys only. The JSON is counterparty-supplied, and a
              // copied absolute URL would surface on the facility's Documents
              // tab as a clickable "contract PDF" pointing wherever the
              // submitter chose (stored-phishing vector).
              !/^[a-z][a-z0-9+.-]*:/i.test((d as { url: string }).url),
          )
          .map((d) => {
            const allowed = ["main", "amendment", "addendum", "exhibit", "pricing"] as const
            type Allowed = (typeof allowed)[number]
            const raw = typeof d.type === "string" ? d.type : ""
            const type: Allowed = (allowed as readonly string[]).includes(raw)
              ? (raw as Allowed)
              : "main"
            return {
              contractId: contract.id,
              name: typeof d.name === "string" && d.name ? d.name : "Contract document",
              url: d.url as string,
              type,
            }
          })
        if (docs.length > 0) {
          await tx.contractDocument.createMany({ data: docs })
        }
      }

      // 2026-06-09 audit: transfer contract-level CATEGORIES. The approve path
      // previously wrote neither productCategoryId nor ContractProductCategory
      // join rows — and the join is the primary category-scope source for
      // market share / compliance (lib/actions/contracts/derived-metrics.ts).
      // Vendor-approved contracts therefore computed over an EMPTY scope (the
      // exact "$105K of $3.29M" bug class fixed on the facility side today).
      // Sources: term scopedCategoryIds (already resolved to names above) plus
      // pricing-file category names, matched case-insensitively against
      // existing ProductCategory rows (no auto-create — unresolvable names are
      // skipped, same posture as the facility import path's strict mode).
      const categoryNameSet = new Set<string>()
      for (const names of resolvedCategoryNamesByTerm.values()) {
        for (const n of names) categoryNameSet.add(n)
      }
      for (const p of pricingItems) {
        if (p.category) categoryNameSet.add(p.category)
      }
      if (categoryNameSet.size > 0) {
        const allCats = await tx.productCategory.findMany({
          select: { id: true, name: true },
        })
        const idByLower = new Map(
          allCats.map((c) => [c.name.trim().toLowerCase(), c.id]),
        )
        const categoryIds = Array.from(
          new Set(
            Array.from(categoryNameSet)
              .map((n) => idByLower.get(n.trim().toLowerCase()))
              .filter((v): v is string => !!v),
          ),
        )
        if (categoryIds.length > 0) {
          await tx.contractProductCategory.createMany({
            data: categoryIds.map((productCategoryId) => ({
              contractId: contract.id,
              productCategoryId,
            })),
            skipDuplicates: true,
          })
        }
      }

      // Charles 2026-07-27: the flip is a tenant-scoped COMPARE-AND-SWAP, not a
      // bare-id update. Two reasons:
      //   - `vendorId` keeps the write inside the row's own tenant. The callers
      //     authorize the read (approvePendingContract: `{id, facilityId}`;
      //     createPendingContract: a row it just created under requireVendor),
      //     but this helper must not depend on that to be safe — a bare
      //     `where: {id}` here would be the exact shape the auth-scope scanner
      //     exists to catch, and CLAUDE.md forbids exempting it by comment.
      //   - `status: "submitted"` re-checks, INSIDE the transaction, the guard
      //     at the top of this function — which read a snapshot taken outside
      //     it. Without the re-check two concurrent approvals of the same row
      //     both pass the guard and both create a Contract (the duplicate-
      //     Contract class the 2026-06-09 audit fixed). The loser now matches
      //     zero rows and its whole transaction rolls back.
      const flipped = await tx.pendingContract.updateMany({
        where: {
          id: pending.id,
          vendorId: pending.vendorId,
          status: "submitted",
        },
        data: {
          status: "approved",
          reviewedAt: new Date(),
          reviewedBy,
          // 2026-06-09 audit: durable link to the created Contract (FK with
          // onDelete: SetNull) — an "approved" row whose approvedContractId is
          // null afterwards means its contract was deleted. Pre-fix this link
          // lived only in a console.info; prod had 7 such undetectable orphans.
          approvedContractId: contract.id,
        },
      })
      if (flipped.count !== 1) {
        throw new Error(
          "This submission changed state while it was being approved (someone else approved or withdrew it). No duplicate contract was created — reload and try again.",
        )
      }

      return contract
    },
    // Large nested pricing createMany (≈46K rows on one prod submission)
    // needs more than the 5s default.
    { timeout: 120_000, maxWait: 10_000 },
  )

  // Charles 2026-04-25 (vendor-mirror Phase 1): close the loop with
  // the vendor — they need to know their submission landed as a real
  // contract.
  //
  // Charles 2026-07-27: `.catch` because notifyVendorOfPendingDecision is
  // itself requireFacility()-gated (it derives the vendor from the row rather
  // than trusting the wire — audit Iter3-B1). On the one-way auto-activation
  // path the actor IS the vendor, so there is no facility session and the
  // helper rejects; without this the fire-and-forget promise would surface as
  // an unhandled rejection. The facility-review path never rejects here, so
  // its behavior is unchanged.
  void notifyVendorOfPendingDecision({
    contractName: pending.contractName,
    vendorName: pending.vendorName,
    facilityName: pending.facilityName,
    pendingId: pending.id,
    approvedContractId: contract.id,
    decision: "approved",
  }).catch((err: unknown) => {
    console.warn(
      "[materializePending] vendor decision notification skipped",
      err,
    )
  })

  // F2 — recompute COG match-statuses so rows flip from
  // off_contract_item → on_contract / price_variance now that the
  // vendor has an active contract with pricing. Facility-scoped by
  // construction — skipped entirely for a standalone (facility-less)
  // vendor contract, which has no COG rows to rematch.
  if (facilityId) {
    await recomputeMatchStatusesForVendor(prisma, {
      vendorId: pending.vendorId,
      facilityId,
    })
    revalidatePath("/dashboard/cog")
    revalidatePath("/dashboard/contracts")
    revalidatePath("/dashboard/alerts")
    revalidatePath("/dashboard")
  }

  // Bug #14 (2026-05-24): after approval, the vendor's My Contracts
  // page must reflect the newly-created Contract row. revalidatePath
  // invalidates the Next.js cache so the vendor's next visit reads
  // fresh data. React Query state stays per-browser; this only
  // helps if the vendor reloads (which is the usual flow).
  revalidatePath("/vendor/contracts")
  revalidatePath(`/vendor/contracts/${contract.id}`)
  if (facilityId) {
    revalidatePath("/dashboard/contracts")
    revalidatePath(`/dashboard/contracts/${contract.id}`)
  }

  // Bug #14 (2026-05-24): post-approval sanity check. If the Contract
  // row isn't readable AFTER all writes, something's wrong with the
  // transaction boundary — throw so the user sees a real error
  // instead of a green-toast-but-no-contract.
  // auth-scope-scanner-skip: post-authorized re-read after the tenant-scoped create;
  // intentionally unscoped so a facilityId mismatch on the new row still surfaces.
  const verifyContract = await prisma.contract.findUnique({
    where: { id: contract.id },
    select: { id: true, vendorId: true, facilityId: true },
  })
  if (!verifyContract) {
    throw new Error(
      `Approval verification failed: Contract ${contract.id} not found after create. Vendor: ${pending.vendorId}, Facility: ${facilityId ?? "none"}. Re-run approval.`,
    )
  }

  console.info("[materializePending] approved", {
    pendingId: pending.id,
    contractId: contract.id,
    vendorId: pending.vendorId,
    facilityId,
    termCount: pendingTerms.length,
    pricingItemCount: pricingItems.length,
  })

  return contract
}

// ─── Vendor: List Pending ───────────────────────────────────────

export async function getVendorPendingContracts(_vendorId?: string) {
  const { vendor } = await requireVendor()

  const contracts = await prisma.pendingContract.findMany({
    // Prospective proposals (lib/actions/prospective.ts createProposal)
    // are stored as draft rows with `pricingData.kind = "vendor_proposal"`
    // — they're internal analysis docs, not submissions, so keep them
    // out of the submissions list (proposal-feed split, 2026-06-09).
    where: { vendorId: vendor.id, ...excludeProspectiveProposalRows() },
    include: { facility: { select: { id: true, name: true } } },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(contracts)
}

// ─── Vendor: Get Single ────────────────────────────────────────

export async function getVendorPendingContract(id: string) {
  const { vendor } = await requireVendor()

  const contract = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, vendorId: vendor.id },
    include: { facility: { select: { id: true, name: true } } },
  })
  return serialize(contract)
}

// ─── Vendor: Create ─────────────────────────────────────────────

/**
 * Every attached document key must have been minted by THIS caller
 * (tenant-provenance prefix, see lib/uploads/key-policy.ts). Without this,
 * a submitter could write any guessable storage key into their own
 * documents JSON and `assertKeyVisibleToUser` would later presign it for
 * them — cross-tenant file read via self-authorization (review 2026-08-05).
 * `carryOver` allows keys already stored on the row being updated, so
 * pre-provenance submissions stay editable.
 */
function assertDocumentKeysOwned(
  docs: readonly { url: string }[] | undefined,
  allowedTenantIds: readonly (string | null | undefined)[],
  carryOver?: ReadonlySet<string>,
): void {
  for (const doc of docs ?? []) {
    if (carryOver?.has(doc.url)) continue
    if (!keyBelongsToTenant(doc.url, allowedTenantIds)) {
      throw new Error(
        `Attached document key "${doc.url.slice(0, 80)}" was not uploaded by this account — re-upload the file and attach it again.`,
      )
    }
  }
}

export async function createPendingContract(input: CreatePendingContractInput) {
  // Charles audit round-6 BLOCKER (same class as round-5 fix in
  // createChangeProposal): authoritative vendor identity must come
  // from requireVendor(), not from client input. Earlier code wrote
  // `vendorId: data.vendorId` verbatim, so an authenticated vendor
  // could submit a PendingContract impersonating any other vendor.
  // Approval propagated the spoofed vendorId onto the live Contract.
  // Facility identity is also looked up from the Facility row when
  // facilityId is provided so the displayed name matches reality.
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  let data: CreatePendingContractInput
  try {
    data = createPendingContractSchema.parse(input)
  } catch (err) {
    // Charles 2026-04-29 Bug A: vendor reports green-toast-but-no-
    // contract. If the schema parse throws, the mutation rejects and
    // the caller's allSettled triggers an error toast (not green) —
    // BUT in prod, the digest is opaque. Log the parse issue with
    // the vendor + payload shape so we can pin field-shape regressions
    // (e.g., contractType not in the enum, capitalLineItems with
    // unexpected nested types) immediately.
    console.error("[createPendingContract] schema parse failed", err, {
      vendorId: vendor.id,
      contractName: input?.contractName,
      contractType: input?.contractType,
      hasPricingData: input?.pricingData != null,
      pricingItemCount:
        (input?.pricingData as { items?: unknown[] } | undefined)?.items
          ?.length ?? 0,
      capitalLineItemCount: input?.capitalLineItems?.length ?? 0,
      termCount: input?.terms?.length ?? 0,
    })
    // Re-throw a readable message (the raw ZodError stringifies to a JSON
    // blob). The fan-out toast surfaces `error.message`, so a clean
    // "field: reason" reaches the vendor instead of an opaque digest.
    if (err instanceof ZodError) {
      const first = err.issues[0]
      const where = first?.path.length ? `${first.path.join(".")}: ` : ""
      throw new Error(`Contract data was invalid — ${where}${first?.message ?? "check the form fields."}`)
    }
    throw err
  }

  // Resolve facility name from the Facility row so a vendor can't
  // forge a facilityName independent of facilityId.
  // New submissions may only attach keys this caller minted.
  assertDocumentKeysOwned(data.documents, [vendor.id, user.id])

  let resolvedFacilityName: string | null | undefined = data.facilityName
  if (data.facilityId) {
    const facility = await prisma.facility.findUnique({
      where: { id: data.facilityId },
      select: { name: true },
    })
    resolvedFacilityName = facility?.name ?? data.facilityName
  }

  let contract: Awaited<ReturnType<typeof prisma.pendingContract.create>>
  try {
    contract = await prisma.pendingContract.create({
    data: {
      vendorId: vendor.id,
      vendorName: vendor.name,
      facilityId: data.facilityId,
      facilityName: resolvedFacilityName,
      contractName: data.contractName,
      contractType: data.contractType,
      effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null,
      expirationDate: data.expirationDate ? new Date(data.expirationDate) : null,
      totalValue: data.totalValue,
      // Charles 2026-04-25 (vendor-mirror Phase 2): persist the
      // field-parity columns. Pre-Phase-2 these were dropped on the
      // floor at the server boundary even when the vendor UI sent
      // them.
      ...(data.contractNumber !== undefined && {
        contractNumber: data.contractNumber,
      }),
      ...(data.annualValue !== undefined && {
        annualValue: data.annualValue,
      }),
      ...(data.gpoAffiliation !== undefined && {
        gpoAffiliation: data.gpoAffiliation,
      }),
      ...(data.performancePeriod !== undefined && {
        performancePeriod: data.performancePeriod,
      }),
      ...(data.rebatePayPeriod !== undefined && {
        rebatePayPeriod: data.rebatePayPeriod,
      }),
      ...(data.autoRenewal !== undefined && {
        autoRenewal: data.autoRenewal,
      }),
      ...(data.terminationNoticeDays !== undefined && {
        terminationNoticeDays: data.terminationNoticeDays,
      }),
      ...(data.capitalCost !== undefined && { capitalCost: data.capitalCost }),
      ...(data.interestRate !== undefined && { interestRate: data.interestRate }),
      ...(data.termMonths !== undefined && { termMonths: data.termMonths }),
      ...(data.downPayment !== undefined && { downPayment: data.downPayment }),
      ...(data.paymentCadence !== undefined && {
        paymentCadence: data.paymentCadence,
      }),
      ...(data.amortizationShape !== undefined && {
        amortizationShape: data.amortizationShape,
      }),
      // Charles audit suggestion #4 (v0-port): multi-item capital JSON.
      ...(data.capitalLineItems !== undefined && {
        capitalLineItems: data.capitalLineItems as Prisma.InputJsonValue,
      }),
      // Charles audit pass-3 C1: tie-in parent + division now persist.
      ...(data.tieInContractId !== undefined && {
        tieInContractId: data.tieInContractId,
      }),
      ...(data.division !== undefined && { division: data.division }),
      terms: data.terms ?? [],
      documents: data.documents ?? [],
      pricingData: data.pricingData,
      notes: data.notes,
      status: "submitted",
    },
  })
  } catch (err) {
    console.error("[createPendingContract] prisma.create failed", err, {
      vendorId: vendor.id,
      facilityId: data.facilityId,
      contractName: data.contractName,
      contractType: data.contractType,
      hasPricingData: data.pricingData != null,
      pricingItemCount:
        (data.pricingData as { items?: unknown[] } | undefined)?.items
          ?.length ?? 0,
      capitalLineItemCount: data.capitalLineItems?.length ?? 0,
      termCount: data.terms?.length ?? 0,
    })
    throw err
  }

  // Charles 2026-07-27: "if it is set up for 1 way on a facility it does not
  // need to submit a contract it just becomes active after creating it."
  // Pre-fix the row was hardcoded `submitted` with no operating-mode branch,
  // and the ONLY exit into a live Contract was approvePendingContract — which
  // opens with requireFacility(). In one-way mode there is no counterparty
  // facility user, so the row sat at "submitted" forever (the stranded
  // Stryker Flex Financial / "2 LSC" submission in the bug report).
  //
  // `canAutoActivate` is the tenant gate, not a convenience: when the payload
  // names a facility it demands an ACCEPTED Connection row for this exact
  // vendor↔facility pair, so a client-supplied facilityId the caller has no
  // relationship with falls through to the ordinary submit-for-review path
  // rather than minting a live contract inside someone else's tenant.
  const resolvedMode = await resolveOperatingMode({
    vendorId: vendor.id,
    facilityId: data.facilityId ?? null,
  })
  if (canAutoActivate(resolvedMode, data.facilityId ?? null)) {
    try {
      await materializePending(contract, data.facilityId ?? null, user.id)
    } catch (err) {
      // The PendingContract row is already committed at this point; leaving it
      // at "submitted" is the recoverable state (the facility can still
      // approve it, or the vendor can delete it). Say so — in prod the client
      // only ever sees a digest unless the message is explicit.
      console.error("[createPendingContract] auto-activation failed", err, {
        vendorId: vendor.id,
        facilityId: data.facilityId ?? null,
        pendingId: contract.id,
        mode: resolvedMode.mode,
        modeSource: resolvedMode.source,
      })
      throw new Error(
        `Contract was saved but could not be activated automatically — ${
          err instanceof Error ? err.message : "unknown error"
        }. It is still listed as a pending submission.`,
      )
    }
    // Deliberately NO notifyFacilityOfPendingContract here: nothing was
    // submitted for review, so there is no reviewer to page.
    //
    // Re-read so callers get the post-materialize row (status "approved",
    // reviewedAt/reviewedBy, approvedContractId) instead of the stale
    // pre-flip snapshot — the vendor's "My Contracts" list keys off status.
    const activated = await prisma.pendingContract.findUniqueOrThrow({
      where: { id: contract.id, vendorId: vendor.id },
    })
    return serialize(activated)
  }

  // Charles 2026-04-25 (vendor-mirror Phase 1): notify the facility
  // so a human knows there's a submission to review. Best-effort; if
  // emails are unconfigured the submission still succeeds.
  if (data.facilityId) {
    void notifyFacilityOfPendingContract({
      facilityId: data.facilityId,
      contractName: data.contractName,
      vendorName: data.vendorName,
      facilityName: data.facilityName ?? null,
      pendingId: contract.id,
    })
  }
  return serialize(contract)
}

// ─── Vendor: Update ─────────────────────────────────────────────

export async function updatePendingContract(id: string, input: UpdatePendingContractInput) {
  const { vendor, user } = await requireVendor()
  await requireCanMutate()
  const data = updatePendingContractSchema.parse(input)

  // Newly attached keys must be caller-minted; keys already stored on this
  // row (pre-provenance uploads) carry over so old drafts stay editable.
  if (data.documents !== undefined) {
    const existing = await prisma.pendingContract.findFirst({
      where: { id, vendorId: vendor.id },
      select: { documents: true },
    })
    const carryOver = new Set<string>()
    if (Array.isArray(existing?.documents)) {
      for (const d of existing.documents) {
        if (d && typeof d === "object" && typeof (d as { url?: unknown }).url === "string") {
          carryOver.add((d as { url: string }).url)
        }
      }
    }
    assertDocumentKeysOwned(data.documents, [vendor.id, user.id], carryOver)
  }

  const contract = await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
    data: {
      ...(data.contractName !== undefined && { contractName: data.contractName }),
      ...(data.contractType !== undefined && { contractType: data.contractType }),
      ...(data.effectiveDate !== undefined && { effectiveDate: data.effectiveDate ? new Date(data.effectiveDate) : null }),
      ...(data.expirationDate !== undefined && { expirationDate: data.expirationDate ? new Date(data.expirationDate) : null }),
      ...(data.totalValue !== undefined && { totalValue: data.totalValue }),
      // Charles 2026-04-25 (vendor-mirror Phase 2): mirror the create
      // path's field-parity columns on update so vendor edits to the
      // pending submission preserve them through the revision loop.
      ...(data.contractNumber !== undefined && {
        contractNumber: data.contractNumber,
      }),
      ...(data.annualValue !== undefined && {
        annualValue: data.annualValue,
      }),
      ...(data.gpoAffiliation !== undefined && {
        gpoAffiliation: data.gpoAffiliation,
      }),
      ...(data.performancePeriod !== undefined && {
        performancePeriod: data.performancePeriod,
      }),
      ...(data.rebatePayPeriod !== undefined && {
        rebatePayPeriod: data.rebatePayPeriod,
      }),
      ...(data.autoRenewal !== undefined && {
        autoRenewal: data.autoRenewal,
      }),
      ...(data.terminationNoticeDays !== undefined && {
        terminationNoticeDays: data.terminationNoticeDays,
      }),
      ...(data.capitalCost !== undefined && { capitalCost: data.capitalCost }),
      ...(data.interestRate !== undefined && { interestRate: data.interestRate }),
      ...(data.termMonths !== undefined && { termMonths: data.termMonths }),
      ...(data.downPayment !== undefined && { downPayment: data.downPayment }),
      ...(data.paymentCadence !== undefined && {
        paymentCadence: data.paymentCadence,
      }),
      ...(data.amortizationShape !== undefined && {
        amortizationShape: data.amortizationShape,
      }),
      ...(data.capitalLineItems !== undefined && {
        capitalLineItems: data.capitalLineItems as Prisma.InputJsonValue,
      }),
      ...(data.tieInContractId !== undefined && {
        tieInContractId: data.tieInContractId,
      }),
      ...(data.division !== undefined && { division: data.division }),
      ...(data.terms !== undefined && { terms: data.terms }),
      ...(data.documents !== undefined && { documents: data.documents }),
      ...(data.pricingData !== undefined && { pricingData: data.pricingData }),
      ...(data.notes !== undefined && { notes: data.notes }),
    },
  })
  return serialize(contract)
}

// ─── Vendor: Withdraw ───────────────────────────────────────────

export async function withdrawPendingContract(id: string) {
  const { vendor } = await requireVendor()
  await requireCanMutate()

  await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
    data: { status: "withdrawn" },
  })
}

// ─── Vendor: Delete ─────────────────────────────────────────────

/**
 * Bug-bash 2026-06-11 B2: vendors had no way to remove a submitted /
 * rejected / revision-requested submission from "My Contracts" — the
 * row sat in the list forever. Hard-deletes the PendingContract row.
 *
 * Deletable = every PendingContractStatus EXCEPT `approved` (draft,
 * submitted, rejected, revision_requested, withdrawn). An `approved`
 * submission is the provenance record behind a real — possibly active —
 * Contract row, so it is never deletable; active Contract rows live in
 * a different table and can't reach this action at all.
 *
 * Same throw-on-failure convention as withdrawPendingContract /
 * resubmitPendingContract above.
 */
export async function deletePendingContract(id: string) {
  const session = await requireVendor()
  await requireCanMutate()

  // Scoped lookup: id + the session vendor's id, so one vendor can never
  // delete another vendor's submission.
  const existing = await prisma.pendingContract.findFirst({
    where: { id, vendorId: session.vendor.id },
    select: { status: true, contractName: true },
  })
  if (!existing) {
    throw new Error("Submission not found.")
  }
  if (existing.status === "approved") {
    throw new Error(
      "Approved submissions cannot be deleted — they back a live contract.",
    )
  }

  await prisma.pendingContract.delete({
    where: { id, vendorId: session.vendor.id },
  })

  await logAudit({
    userId: session.user.id,
    action: "pending_contract.deleted",
    entityType: "pendingContract",
    entityId: id,
    metadata: {
      status: existing.status,
      contractName: existing.contractName,
    },
  })

  revalidatePath("/vendor/contracts")
}

// ─── Vendor: Resubmit ───────────────────────────────────────────

/**
 * Charles 2026-06-10 ("submit one on the vendor side and reject it on the
 * facility side then edit on the vendor side — it is not working"): the
 * rejected→edit→resubmit loop had NO action that moved a submission back to
 * `submitted` — updatePendingContract never touches status, so an edited
 * rejected/revision_requested row stayed terminal and the facility never
 * saw the revision. This flips it back into the facility's review queue.
 */
export async function resubmitPendingContract(id: string) {
  const { vendor } = await requireVendor()
  await requireCanMutate()

  const existing = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, vendorId: vendor.id },
    select: {
      status: true,
      contractName: true,
      facilityId: true,
      vendorName: true,
      facility: { select: { name: true } },
    },
  })
  if (
    existing.status !== "rejected" &&
    existing.status !== "revision_requested" &&
    existing.status !== "draft"
  ) {
    throw new Error(
      `Only rejected, revision-requested, or draft submissions can be resubmitted (status: ${existing.status}).`,
    )
  }

  const contract = await prisma.pendingContract.update({
    where: { id, vendorId: vendor.id },
    data: { status: "submitted", submittedAt: new Date() },
  })

  // Same best-effort facility notification as the original submission.
  if (existing.facilityId) {
    void notifyFacilityOfPendingContract({
      facilityId: existing.facilityId,
      contractName: existing.contractName,
      vendorName: existing.vendorName,
      facilityName: existing.facility?.name ?? null,
      pendingId: id,
    })
  }
  return serialize(contract)
}

// ─── Facility: List Pending ─────────────────────────────────────

export async function getFacilityPendingContracts(_facilityId?: string) {
  const { facility } = await requireFacility()

  // 2026-06-09 (Charles "rejecting a vendor contract — it goes nowhere"):
  // this previously filtered `status: "submitted"`, so the moment a
  // submission was rejected / sent back for revision / approved it VANISHED
  // from the facility's view with no trace — no rejected list, no review
  // notes, nothing. Return every status; the tab groups "awaiting review"
  // vs "reviewed" so decisions stay visible.
  const contracts = await prisma.pendingContract.findMany({
    where: { facilityId: facility.id },
    include: { vendor: { select: { id: true, name: true, logoUrl: true } } },
    orderBy: { submittedAt: "desc" },
  })
  return serialize(contracts)
}

// ─── Facility: Approve ──────────────────────────────────────────

export async function approvePendingContract(id: string, _reviewedByIgnored?: string) {
  // Charles audit round-7 CONCERN: reviewedBy comes from session, not
  // client. Pre-fix the client-supplied string was written verbatim to
  // the audit field, so the reviewer-of-record could be forged.
  const { facility, user } = await requireFacility()
  await requireCanMutate()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  // Everything from the "submitted"-only guard through the contract create,
  // the pending-row flip, the notifications and the revalidations now lives
  // in materializePending (shared with the one-way auto-activation path in
  // createPendingContract). The facility-scoped read above is what authorizes
  // this call — materializePending does no auth of its own.
  const contract = await materializePending(pending, facility.id, user.id)

  return serialize(contract)
}

// ─── Facility: Reject ───────────────────────────────────────────

export async function rejectPendingContract(id: string, _reviewedByIgnored: string, notes: string) {
  // Charles audit round-7 CONCERN: reviewedBy from session.
  const { facility, user } = await requireFacility()
  await requireCanMutate()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "rejected",
      reviewedAt: new Date(),
      reviewedBy: user.id,
      reviewNotes: notes,
    },
  })

  void notifyVendorOfPendingDecision({
    contractName: pending.contractName,
    vendorName: pending.vendorName,
    facilityName: pending.facilityName,
    pendingId: pending.id,
    decision: "rejected",
    reviewNotes: notes,
  })

  // 2026-06-09: bust the route caches like approve does — without this the
  // facility's server-rendered views kept serving the pre-decision state.
  revalidatePath("/dashboard/contracts")
  revalidatePath("/vendor/contracts")
}

// ─── Facility: Request Revision ─────────────────────────────────

export async function requestRevision(id: string, _reviewedByIgnored: string, notes: string) {
  // Charles audit round-7 CONCERN: reviewedBy from session.
  const { facility, user } = await requireFacility()
  await requireCanMutate()

  const pending = await prisma.pendingContract.findUniqueOrThrow({
    where: { id, facilityId: facility.id },
  })

  await prisma.pendingContract.update({
    where: { id, facilityId: facility.id },
    data: {
      status: "revision_requested",
      reviewedAt: new Date(),
      reviewedBy: user.id,
      reviewNotes: notes,
    },
  })

  void notifyVendorOfPendingDecision({
    contractName: pending.contractName,
    vendorName: pending.vendorName,
    facilityName: pending.facilityName,
    pendingId: pending.id,
    decision: "revision_requested",
    reviewNotes: notes,
  })

  // 2026-06-09: bust the route caches like approve does.
  revalidatePath("/dashboard/contracts")
  revalidatePath("/vendor/contracts")
}
