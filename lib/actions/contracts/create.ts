"use server"

// Split from lib/actions/contracts.ts (subsystem F5 decomposition,
// 2026-08-05). No barrel at the old path — Next.js disallows
// non-async-function re-exports from "use server" modules.

import { prisma } from "@/lib/db"
import { requireFacility } from "@/lib/actions/auth"
import { requireCanMutate } from "@/lib/actions/auth-permissions"
import {
  createContractSchema,
  type CreateContractInput,
} from "@/lib/validators/contracts"
import { Prisma } from "@/lib/generated/prisma/client"
import { serialize } from "@/lib/serialize"
import { logAudit } from "@/lib/audit"
import { revalidatePath } from "next/cache"
import {
  invalidateContractAnalytics,
  invalidateFacilityAnalytics,
} from "@/lib/actions/analytics/_cache"
import { idempotencyGet, idempotencyPut } from "@/lib/idempotency"
import { recomputeMatchStatusesForVendor } from "@/lib/cog/recompute"
import { recomputeAccrualForContract } from "@/lib/actions/contracts/recompute-accrual"
import { recomputeCaseSupplyContractStatus } from "@/lib/case-costing/recompute-supply"
import { refreshContractMetricsForVendor } from "@/lib/actions/contracts/refresh-metrics"
import {
  termFormSchemaWithTierCheck,
  type TermFormValues,
} from "@/lib/validators/contract-terms"
import { resolveCategoryIdsToNames } from "@/lib/contracts/resolve-category-names"
import { normalizeScopedItemNumbers } from "@/lib/contracts/normalize-scoped-item-numbers"
import { humanizeCreateContractError } from "@/lib/contracts/humanize-create-contract-error"

// ─── Create Contract ─────────────────────────────────────────────

export async function createContract(
  input: CreateContractInput & { terms?: TermFormValues[] },
) {
  try {
    return await _createContractImpl(input)
  } catch (err) {
    console.error("[createContract]", err, {
      name: input.name,
      vendorId: input.vendorId,
      contractType: input.contractType,
      termCount: Array.isArray(input.terms) ? input.terms.length : 0,
    })
    // Bug #9 — surface the real reason instead of letting Next.js redact
    // the server-action error to "An error occurred in the Server
    // Components render." The client toast pattern in
    // `useCreateContract.onError` uses `error.message`, so a sanitized
    // explanatory message has to arrive ON the Error itself.
    throw new Error(humanizeCreateContractError(err))
  }
}

/**
 * Error-as-value variant of createContract for production resilience.
 *
 * Vick 2026-05-30: in production Next.js 16 builds, Errors thrown
 * from Server Actions are stripped — the client only sees a generic
 * "An error occurred in the Server Components render." digest. Even
 * a thoughtfully-humanized `throw new Error(...)` is discarded for
 * security. This wrapper RETURNS the error as a serializable value
 * instead, which crosses the action boundary intact.
 *
 * Use this from React Query mutations; throw from the mutationFn
 * if `!result.ok` so the rest of the React Query API (onError,
 * isError) keeps working.
 */
export async function createContractSafe(
  input: CreateContractInput & { terms?: TermFormValues[] },
): Promise<
  | { ok: true; contract: Awaited<ReturnType<typeof _createContractImpl>> }
  | { ok: false; error: string; code?: string }
> {
  try {
    const contract = await _createContractImpl(input)
    return { ok: true, contract }
  } catch (err) {
    console.error("[createContractSafe]", err, {
      name: input.name,
      vendorId: input.vendorId,
      contractType: input.contractType,
      termCount: Array.isArray(input.terms) ? input.terms.length : 0,
    })
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code?: unknown }).code ?? "")
        : undefined
    return { ok: false, error: humanizeCreateContractError(err), code }
  }
}

async function _createContractImpl(
  input: CreateContractInput & { terms?: TermFormValues[] },
) {
  const session = await requireFacility()
  await requireCanMutate()
  const data = createContractSchema.parse(input)
  // Terms travel alongside the validated contract payload rather than as
  // part of it — embedding them in createContractSchema makes react-hook-form's
  // zodResolver unhappy because termFormSchema defaults force the infer'd
  // type to diverge from the input type. We validate them separately below.
  const dataTerms: TermFormValues[] = Array.isArray(input.terms)
    ? input.terms.map((t) => termFormSchemaWithTierCheck.parse(t))
    : []

  // bugs.rtfd 2026-06-11 B1 — dedupe window for create-contract. Both
  // dedupe layers (in-memory idempotency TTL below + the DB soft-dedupe
  // lookback) were 30s, but the post-create pricing-file import runs
  // under a 120s transaction timeout (lib/actions/pricing-files.ts), so
  // a second click mid-import landed OUTSIDE both windows and wrote a
  // duplicate contract. 180s = 120s import ceiling + margin. Local
  // (non-exported) const — "use server" files may only export async fns.
  const CREATE_DEDUPE_WINDOW_MS = 180_000

  // Charles W1.W-E1 — idempotency. When the client supplies a key we
  // hold a CREATE_DEDUPE_WINDOW_MS cache of (key → created contract).
  // A second call within the window (double-click, network retry, HMR
  // race, re-click during the post-create pricing import) returns the
  // original contract instead of writing a duplicate row. Scope the
  // cache by user+facility so two users can't collide.
  type CachedContract = Awaited<ReturnType<typeof prisma.contract.create>>
  const idempotencyScope = `create-contract:${session.user.id}:${session.facility.id}`
  if (data.idempotencyKey) {
    const cached = idempotencyGet<CachedContract>(
      idempotencyScope,
      data.idempotencyKey,
    )
    if (cached) return cached
  }

  // Charles W1.Y-B — DB-level soft-dedupe. The in-memory idempotency
  // map above covers fast double-clicks inside one form session, but
  // misses (a) TTL-expired re-submits, (b) submit paths that forgot to
  // thread an idempotency key through, and (c) multi-instance deploys
  // where the cache is process-local. Before writing, look for a
  // contract with the same business key `(facility, vendor, name,
  // effectiveDate)` created within CREATE_DEDUPE_WINDOW_MS; if one
  // exists, return it instead of writing a duplicate row. The business
  // key is specific enough (same vendor + exact name + exact effective
  // date) that a user genuinely creating two near-identical contracts
  // inside the window still succeeds by varying the name.
  const recentDup = await prisma.contract.findFirst({
    where: {
      facilityId: session.facility.id,
      vendorId: data.vendorId,
      name: data.name,
      effectiveDate: new Date(data.effectiveDate),
      createdAt: { gte: new Date(Date.now() - CREATE_DEDUPE_WINDOW_MS) },
    },
  })
  if (recentDup) {
    const replay = serialize(recentDup)
    if (data.idempotencyKey) {
      idempotencyPut(
        idempotencyScope,
        data.idempotencyKey,
        replay,
        CREATE_DEDUPE_WINDOW_MS,
      )
    }
    return replay
  }

  // Charles 2026-04-24 (Bug 10): wrap contract + terms + tiers +
  // ContractTermProduct + additional facilities in a single interactive
  // transaction so term #N failing mid-loop (e.g. a bad tier row) rolls
  // back the whole contract instead of leaving a half-saved header with
  // some-but-not-all terms. Pre-resolve scoped category IDs → names
  // BEFORE opening the transaction so we don't hold it open on a
  // read-only lookup. Post-write rebate-accrual + COG match recomputes
  // stay outside the tx — they're idempotent best-effort and shouldn't
  // block the write from committing.
  const resolvedCategoryNamesByTerm = new Map<number, string[]>()
  for (let i = 0; i < dataTerms.length; i++) {
    const ids = dataTerms[i].scopedCategoryIds
    if (ids && ids.length > 0) {
      resolvedCategoryNamesByTerm.set(i, await resolveCategoryIdsToNames(ids))
    }
  }

  const contract = await prisma.$transaction(async (tx) => {
    const created = await tx.contract.create({
    data: {
      name: data.name,
      contractNumber: data.contractNumber,
      vendorId: data.vendorId,
      facilityId: session.facility.id,
      productCategoryId: data.productCategoryId,
      contractType: data.contractType,
      status: data.status,
      effectiveDate: new Date(data.effectiveDate),
      // Empty string → evergreen sentinel. Prisma Contract.expirationDate
      // is NOT NULL (prisma/schema.prisma line 601), so we write the
      // sentinel 9999-12-31 instead of null. `formatDate` renders it as
      // "Evergreen"; `lib/contracts/match.ts:156` treats any date past
      // the COG transaction as in-window, so every future row matches.
      expirationDate: data.expirationDate
        ? new Date(data.expirationDate)
        : new Date(Date.UTC(9999, 11, 31)),
      autoRenewal: data.autoRenewal,
      terminationNoticeDays: data.terminationNoticeDays,
      totalValue: data.totalValue,
      annualValue: data.annualValue,
      description: data.description,
      notes: data.notes,
      gpoAffiliation: data.gpoAffiliation,
      performancePeriod: data.performancePeriod,
      rebatePayPeriod: data.rebatePayPeriod,
      isMultiFacility: data.isMultiFacility,
      isGrouped: data.isGrouped ?? false,
      additionalVendorIds: data.additionalVendorIds ?? [],
      tieInCapitalContractId: data.tieInCapitalContractId,
      // Charles audit suggestion #4 (v0-port): legacy capital fields
      // removed — capital lives in ContractCapitalLineItem rows now.
      // amortizationShape is the only contract-level capital field
      // that survives.
      ...(data.amortizationShape != null && {
        amortizationShape: data.amortizationShape,
      }),
      // Charles 2026-04-25 (audit follow-up): persist contract-level
      // metrics that drive compliance + market-share rebate accruals.
      ...(data.complianceRate != null && { complianceRate: data.complianceRate }),
      ...(data.currentMarketShare != null && {
        currentMarketShare: data.currentMarketShare,
      }),
      ...(data.marketShareCommitment != null && {
        marketShareCommitment: data.marketShareCommitment,
      }),
      ...(data.marketShareCommitmentByCategory !== undefined && {
        // null clears (Prisma's `Prisma.JsonNull` sentinel); array
        // value passes through as InputJsonValue.
        marketShareCommitmentByCategory:
          data.marketShareCommitmentByCategory === null
            ? Prisma.JsonNull
            : (data.marketShareCommitmentByCategory as Prisma.InputJsonValue),
      }),
      createdById: session.user.id,
      ...(data.facilityIds.length > 0 && {
        isMultiFacility: true,
        contractFacilities: {
          create: data.facilityIds.map((fId) => ({ facilityId: fId })),
        },
      }),
      ...(data.categoryIds.length > 0 && {
        contractCategories: {
          create: data.categoryIds.map((cId) => ({ productCategoryId: cId })),
        },
      }),
    },
  })

  // Charles — atomic term+tier persistence. Terms used to be written
  // by a client-side loop calling `createContractTerm` after `createContract`
  // returned; a stale Next.js server-action hash (or any network blip)
  // between the two round-trips would leave the contract with no terms.
  // Users then saw a contract they had to "Edit" to re-save terms. By
  // writing terms inside this same server action, the only failure mode
  // is "nothing saved, error surfaced to client" — never half-saved.
  if (dataTerms.length > 0) {
    for (let termIdx = 0; termIdx < dataTerms.length; termIdx++) {
      const formTerm = dataTerms[termIdx]
      const {
        tiers,
        scopedItemNumbers,
        scopedCategoryId: _scopedCategoryId,
        scopedCategoryIds,
        customAmortizationRows: _customAmortizationRows,
        capitalCost: _termCapitalCost,
        interestRate: _termInterestRate,
        termMonths: _termMonths,
        downPayment: _termDownPayment,
        paymentCadence: _termPaymentCadence,
        amortizationShape: _termAmortizationShape,
        id: _termId,
        ...termData
      } = formTerm
      void _scopedCategoryId
      void _customAmortizationRows
      void _termCapitalCost
      void _termInterestRate
      void _termMonths
      void _termDownPayment
      void _termPaymentCadence
      void _termAmortizationShape
      void _termId

      // Empty effectiveEnd → same evergreen sentinel the parent contract
      // uses. Required because terms nested in the create payload from the
      // AI-extract path inherit the parent contract's effective window;
      // when AI returns null expirationDate (evergreen), the form passes
      // "" through, and `new Date("")` is Invalid Date → Prisma rejects.
      const EVERGREEN = new Date(Date.UTC(9999, 11, 31))
      const resolvedCategoryNames = resolvedCategoryNamesByTerm.get(termIdx)
      const termCreateData: Prisma.ContractTermCreateInput = {
        ...termData,
        effectiveStart: termData.effectiveStart
          ? new Date(termData.effectiveStart)
          : new Date(Date.UTC(1970, 0, 1)),
        effectiveEnd: termData.effectiveEnd
          ? new Date(termData.effectiveEnd)
          : EVERGREEN,
        contract: { connect: { id: created.id } },
        ...(resolvedCategoryNames && resolvedCategoryNames.length > 0 && {
          categories: resolvedCategoryNames,
        }),
        ...(tiers.length > 0 && {
          tiers: {
            create: tiers.map((tier) => ({
              tierNumber: tier.tierNumber,
              spendMin: tier.spendMin,
              spendMax: tier.spendMax,
              volumeMin: tier.volumeMin,
              volumeMax: tier.volumeMax,
              marketShareMin: tier.marketShareMin,
              marketShareMax: tier.marketShareMax,
              rebateType: tier.rebateType,
              rebateValue: tier.rebateValue,
            })),
          },
        }),
      }
      const createdTerm = await tx.contractTerm.create({
        data: termCreateData,
      })

      const normalizedScopedItemNumbers =
        normalizeScopedItemNumbers(scopedItemNumbers)
      if (normalizedScopedItemNumbers.length > 0) {
        await tx.contractTermProduct.createMany({
          data: normalizedScopedItemNumbers.map((vendorItemNo) => ({
            termId: createdTerm.id,
            vendorItemNo,
          })),
          skipDuplicates: true,
        })
      }
    }
  }

  // Persist additional facilities selected via the multi-facility picker.
  // Uses the ContractFacility join table with skipDuplicates so repeat
  // saves (or overlap with data.facilityIds above) don't violate the
  // (contractId, facilityId) unique index.
  if (data.additionalFacilityIds?.length) {
    await tx.contractFacility.createMany({
      data: data.additionalFacilityIds.map((fid) => ({
        contractId: created.id,
        facilityId: fid,
      })),
      skipDuplicates: true,
    })
  }

    return created
  })

  // Keep auto-accrual rebate rows in sync — idempotent best-effort after
  // the transaction commits, so a recompute failure doesn't roll back
  // the saved contract (the user can re-trigger via "Recompute").
  if (dataTerms.length > 0) {
    try {
      await recomputeAccrualForContract(contract.id)
    } catch (err) {
      console.warn(
        `[createContract] recomputeAccrualForContract(${contract.id}) failed:`,
        err,
      )
    }
  }

  await logAudit({
    userId: session.user.id,
    action: "contract.created",
    entityType: "contract",
    entityId: contract.id,
    metadata: { name: data.name, vendorId: data.vendorId },
  })

  // Recompute COG match-statuses for this vendor so rows flip to
  // on_contract / price_variance / out_of_scope as appropriate.
  //
  // W2.A.1 H-B: fan out across every facility the contract touches —
  // {contract.facilityId} ∪ data.facilityIds ∪ data.additionalFacilityIds.
  // Previously we only recomputed for `session.facility.id`, which left
  // COG rows at peer facilities on a multi-facility contract stuck at
  // matchStatus=pending. De-dupe via Set so the same pair can't be
  // recomputed twice in one CRUD.
  {
    const facilityIds = new Set<string>()
    if (contract.facilityId) facilityIds.add(contract.facilityId)
    for (const fId of data.facilityIds) facilityIds.add(fId)
    for (const fId of data.additionalFacilityIds ?? []) facilityIds.add(fId)
    // #2 (Vick 2026-05-31): recompute match statuses for EVERY participating
    // vendor of a grouped contract — not just the primary. Otherwise the
    // group's secondary-vendor COG never gets re-matched (the matcher now
    // attributes it, but only if its vendor is in the recompute scope), so
    // group spend + carve-out stay empty after a save.
    const vendorIds = new Set<string>([data.vendorId])
    for (const v of data.additionalVendorIds ?? []) vendorIds.add(v)
    for (const facilityId of facilityIds) {
      for (const vendorId of vendorIds) {
        await recomputeMatchStatusesForVendor(prisma, { vendorId, facilityId })
        // 2026-06-07 (Vick "every time a contract is created these should
        // auto run"): refresh the persisted derived metrics
        // (complianceRate, currentMarketShare, annualValue) right after the
        // match recompute — same fan-out as bulkImportCOGRecords. Before this,
        // a contract created AFTER its COG was imported showed no
        // matches/market-share until the user manually edited+saved or hit
        // "Recompute Earned Rebates". Best-effort: a metrics-refresh failure
        // must never roll back or surface from the create (mirrors the
        // rebate-accrual / case-supply recompute pattern below).
        try {
          await refreshContractMetricsForVendor({ vendorId, facilityId })
        } catch (err) {
          console.warn(
            `[createContract] refreshContractMetricsForVendor(${vendorId}, ${facilityId}) failed:`,
            err,
          )
        }
      }
      // Charles 2026-04-25 (Bug 27 part 2): keep CaseSupply.isOnContract
      // in sync with the contract catalog so Case Costing's "Avg
      // On-Contract %" reflects newly-added/removed contracts.
      // Best-effort — a recompute failure logs but doesn't block the
      // create from succeeding (matches the rebate-accrual recompute
      // pattern).
      try {
        await recomputeCaseSupplyContractStatus(prisma, facilityId)
      } catch (err) {
        console.warn(
          `[createContract] recomputeCaseSupplyContractStatus(${facilityId}) failed:`,
          err,
        )
      }
    }
  }

  // Contract health-score feature removed 2026-04-23 (Bug 15) — the
  // A-F rollup was unclear in provenance ("what is this score based on?
  // not sure we need that") so the whole subsystem was ripped out.

  revalidatePath("/dashboard/cog")
  revalidatePath("/dashboard/contracts")
  revalidatePath("/dashboard")
  // New contract → invalidate facility-scoped analytics so spend
  // concentration / admin time savings counts pick up the row.
  if (contract.facilityId) {
    await invalidateFacilityAnalytics(contract.facilityId)
  }
  await invalidateContractAnalytics(contract.id)

  const result = serialize(contract)

  // Charles W1.W-E1 — cache the serialized result under the client's
  // idempotency key so a concurrent double-submit returns this contract
  // rather than writing another row. TTL extended to the B1 dedupe
  // window so the cache outlives the post-create pricing import.
  if (data.idempotencyKey) {
    idempotencyPut(
      idempotencyScope,
      data.idempotencyKey,
      result,
      CREATE_DEDUPE_WINDOW_MS,
    )
  }

  return result
}
