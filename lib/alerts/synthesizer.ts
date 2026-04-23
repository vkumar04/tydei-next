/**
 * Alert synthesizer — pure rules engine (spec §subsystem-1,
 * docs/superpowers/specs/2026-04-18-alerts-rewrite.md).
 *
 * PURE FUNCTION: takes all data shapes as params, returns un-persisted
 * alert rows + a `toResolve` list of existing-alert ids whose underlying
 * condition no longer applies. NO prisma imports.
 *
 * Persistence (create + resolve) is wired in a later subsystem (4) by a
 * server action that loads the inputs, calls this function, and applies
 * the delta atomically.
 *
 * Covers the 5 canonical alert types from spec §2:
 *   - off_contract      (COG rows with matchStatus='off_contract_item')
 *   - expiring_contract (contracts within 90 days of expiration)
 *   - tier_threshold    (within 20% of the next tier — spec §subsystem-1)
 *   - rebate_due        (ContractPeriod with rebateEarned>0, rebateCollected==0, past due)
 *   - payment_due       (capital payment schedules, optional input shape)
 */

import type {
  ExpiringContractMeta,
  OffContractMeta,
  PaymentDueMeta,
  RebateDueMeta,
  TierThresholdMeta,
} from "./metadata"

// ─── Input shapes ────────────────────────────────────────────────

export interface SynthCogRecord {
  id: string
  poNumber: string | null
  vendorId: string | null
  vendorName: string | null
  inventoryNumber: string
  inventoryDescription: string
  unitCost: number
  quantity: number
  extendedPrice: number | null
  contractPrice: number | null
  matchStatus: string // 'off_contract_item' | 'on_contract' | ...
  transactionDate: Date
}

export interface SynthTier {
  tierNumber: number
  spendMin: number
  spendMax: number | null
  rebateValue: number
}

export interface SynthContract {
  id: string
  name: string
  status: string
  expirationDate: Date
  annualValue: number
  vendorId: string
  vendorName: string
  /** Flattened cumulative spend from the most recent ContractPeriod. */
  currentSpend: number
  /** All tiers from this contract's active term, sorted or not. */
  tiers: SynthTier[]
}

export interface SynthContractPeriod {
  id: string
  contractId: string
  contractName: string
  vendorId: string
  vendorName: string
  periodStart: Date
  periodEnd: Date
  rebateEarned: number
  rebateCollected: number
}

export interface SynthPaymentSchedule {
  id: string
  contractId: string
  contractName: string
  vendorId: string
  vendorName: string
  amount: number
  dueDate: Date
  paidAt: Date | null
}

export interface SynthExistingAlert {
  id: string
  alertType: string
  contractId: string | null
  vendorId: string | null
  /** Metadata as stored in the DB (Json). */
  metadata: Record<string, unknown>
  status: string // 'new_alert' | 'read' | 'resolved' | 'dismissed'
}

export interface SynthInput {
  facilityId: string
  /** `now` override — tests pass a fixed date. */
  now?: Date
  cogRecords: SynthCogRecord[]
  contracts: SynthContract[]
  contractPeriods: SynthContractPeriod[]
  paymentSchedules?: SynthPaymentSchedule[]
  /** Currently-active (non-dismissed, non-resolved) alerts. */
  existingAlerts: SynthExistingAlert[]
}

// ─── Output shapes ───────────────────────────────────────────────

/**
 * An un-persisted alert ready for prisma.alert.create().
 * The caller is responsible for coercing `metadata` to a Prisma.InputJsonValue.
 */
export interface SynthAlert {
  portalType: "facility"
  alertType:
    | "off_contract"
    | "expiring_contract"
    | "tier_threshold"
    | "rebate_due"
    | "payment_due"
  title: string
  description: string
  severity: "high" | "medium" | "low"
  facilityId: string
  contractId?: string
  vendorId?: string
  actionLink?: string
  metadata: Record<string, unknown>
  /**
   * A stable de-duplication key so the caller can diff against existing
   * alerts without re-implementing the matching logic. Format:
   * `<alertType>:<primaryEntityId>[:<sub-key>]`.
   */
  dedupeKey: string
}

export interface SynthResult {
  toCreate: SynthAlert[]
  toResolve: string[] // existing alert ids whose condition is no longer true
}

// ─── Thresholds (spec §subsystem-1) ──────────────────────────────

/** Off-contract vendor must exceed this total to raise an alert. */
export const OFF_CONTRACT_DOLLAR_THRESHOLD = 1000
/** Or meet this item count. */
export const OFF_CONTRACT_COUNT_THRESHOLD = 3
/** Contracts within N days of expiration raise an alert. */
export const EXPIRING_CONTRACT_WINDOW_DAYS = 90
/** Raise a tier_threshold alert when spend is within this fraction of the next tier. */
export const TIER_THRESHOLD_PERCENT = 0.2
/** Raise payment_due alert this many days before the scheduled date. */
export const PAYMENT_DUE_LEAD_DAYS = 14

// ─── Helpers ─────────────────────────────────────────────────────

function daysBetween(a: Date, b: Date): number {
  return Math.ceil((a.getTime() - b.getTime()) / (24 * 60 * 60 * 1000))
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function dedupeKeyFor(
  alertType: SynthAlert["alertType"],
  primary: string,
  sub?: string | number,
): string {
  return sub === undefined
    ? `${alertType}:${primary}`
    : `${alertType}:${primary}:${sub}`
}

function findExistingByDedupe(
  existing: SynthExistingAlert[],
  key: string,
): SynthExistingAlert | undefined {
  return existing.find((a) => {
    const meta = a.metadata as { dedupeKey?: unknown }
    return typeof meta?.dedupeKey === "string" && meta.dedupeKey === key
  })
}

// ─── Rule 1: off_contract ────────────────────────────────────────

function synthOffContract(input: SynthInput): {
  create: SynthAlert[]
  keepKeys: Set<string>
} {
  const create: SynthAlert[] = []
  const keepKeys = new Set<string>()

  // Group off-contract rows by vendor.
  const byVendor = new Map<
    string,
    {
      vendorName: string
      items: SynthCogRecord[]
    }
  >()

  for (const r of input.cogRecords) {
    if (r.matchStatus !== "off_contract_item") continue
    if (!r.vendorId) continue
    const bucket = byVendor.get(r.vendorId)
    if (bucket) {
      bucket.items.push(r)
    } else {
      byVendor.set(r.vendorId, {
        vendorName: r.vendorName ?? "Unknown vendor",
        items: [r],
      })
    }
  }

  for (const [vendorId, { vendorName, items }] of byVendor) {
    const total = items.reduce(
      (sum, i) =>
        sum + (i.extendedPrice ?? i.unitCost * i.quantity),
      0,
    )
    const count = items.length
    if (
      total < OFF_CONTRACT_DOLLAR_THRESHOLD &&
      count < OFF_CONTRACT_COUNT_THRESHOLD
    ) {
      continue
    }

    // Group further by PO so each row can carry its own line items.
    const byPo = new Map<string, SynthCogRecord[]>()
    for (const i of items) {
      const k = i.poNumber ?? "_"
      const arr = byPo.get(k)
      if (arr) arr.push(i)
      else byPo.set(k, [i])
    }

    for (const [poId, poItems] of byPo) {
      const poTotal = poItems.reduce(
        (s, i) => s + (i.extendedPrice ?? i.unitCost * i.quantity),
        0,
      )
      const dedupeKey = dedupeKeyFor(
        "off_contract",
        vendorId,
        poId === "_" ? "nopo" : poId,
      )
      keepKeys.add(dedupeKey)

      if (findExistingByDedupe(input.existingAlerts, dedupeKey)) continue

      const meta: OffContractMeta & { dedupeKey: string } = {
        po_id: poId === "_" ? "" : poId,
        vendor_name: vendorName,
        item_count: poItems.length,
        total_amount: poTotal,
        items: poItems.map((i) => ({
          sku: i.inventoryNumber,
          name: i.inventoryDescription,
          quantity: i.quantity,
          unitPrice: i.unitCost,
          contractPrice: i.contractPrice,
        })),
        dedupeKey,
      }

      create.push({
        portalType: "facility",
        alertType: "off_contract",
        title:
          poId === "_"
            ? `${poItems.length} off-contract item${poItems.length > 1 ? "s" : ""} from ${vendorName}`
            : `Off-contract PO ${poId} from ${vendorName}`,
        description: `$${poTotal.toLocaleString()} in off-contract spend (${poItems.length} line item${poItems.length > 1 ? "s" : ""}).`,
        severity: poTotal > 50000 ? "high" : poTotal > 10000 ? "medium" : "low",
        facilityId: input.facilityId,
        vendorId,
        actionLink: poId === "_" ? `/dashboard/purchase-orders` : `/dashboard/purchase-orders?po=${encodeURIComponent(poId)}`,
        metadata: meta as unknown as Record<string, unknown>,
        dedupeKey,
      })
    }
  }

  return { create, keepKeys }
}

// ─── Rule 2: expiring_contract ───────────────────────────────────

/**
 * Classify an expiring-contract alert's severity by days remaining.
 *
 * Aligned to v0 spec (docs/contract-calculations.md §10
 * `CONTRACT_EXPIRING`):
 *   v0 critical ≤ 7   → tydei "high"
 *   v0 high     ≤ 14  → tydei "high" (tydei has no "critical" level)
 *   v0 warning  ≤ 30  → tydei "medium"
 *   v0 none     > 30  → tydei "low" (within the 90-day alert window)
 *
 * Pre-2026-04-23 this bucket used 30/60 thresholds ("high" up to 30,
 * "medium" up to 60) which disagreed with v0 and over-weighted mid-
 * range alerts. Oracle parity check in e2e-synthetic-test.ts pins this.
 */
export function classifyExpirationSeverity(
  daysRemaining: number,
): SynthAlert["severity"] {
  if (daysRemaining <= 14) return "high"
  if (daysRemaining <= 30) return "medium"
  return "low"
}

function synthExpiringContract(input: SynthInput, now: Date): {
  create: SynthAlert[]
  keepKeys: Set<string>
} {
  const create: SynthAlert[] = []
  const keepKeys = new Set<string>()

  for (const c of input.contracts) {
    if (c.status !== "active") continue
    const days = daysBetween(c.expirationDate, now)
    if (days < 0 || days > EXPIRING_CONTRACT_WINDOW_DAYS) continue

    const dedupeKey = dedupeKeyFor("expiring_contract", c.id)
    keepKeys.add(dedupeKey)
    if (findExistingByDedupe(input.existingAlerts, dedupeKey)) continue

    const severity = classifyExpirationSeverity(days)

    const meta: ExpiringContractMeta & { dedupeKey: string } = {
      contract_name: c.name,
      contract_id: c.id,
      vendor_name: c.vendorName,
      days_until_expiry: days,
      expiration_date: isoDate(c.expirationDate),
      annual_value: c.annualValue,
      dedupeKey,
    }

    create.push({
      portalType: "facility",
      alertType: "expiring_contract",
      title: `Contract "${c.name}" expires in ${days} day${days === 1 ? "" : "s"}`,
      description: `Expires ${isoDate(c.expirationDate)} with ${c.vendorName}.`,
      severity,
      facilityId: input.facilityId,
      contractId: c.id,
      vendorId: c.vendorId,
      actionLink: `/dashboard/contracts/${c.id}`,
      metadata: meta as unknown as Record<string, unknown>,
      dedupeKey,
    })
  }

  return { create, keepKeys }
}

// ─── Rule 3: tier_threshold ──────────────────────────────────────

function synthTierThreshold(input: SynthInput): {
  create: SynthAlert[]
  keepKeys: Set<string>
} {
  const create: SynthAlert[] = []
  const keepKeys = new Set<string>()

  for (const c of input.contracts) {
    if (c.status !== "active") continue
    if (c.tiers.length === 0) continue

    const sorted = [...c.tiers].sort((a, b) => a.spendMin - b.spendMin)
    // Identify the next tier above currentSpend.
    const nextTier = sorted.find((t) => c.currentSpend < t.spendMin)
    if (!nextTier) continue

    const gap = nextTier.spendMin - c.currentSpend
    const pctRemaining = gap / nextTier.spendMin
    if (pctRemaining > TIER_THRESHOLD_PERCENT) continue

    const dedupeKey = dedupeKeyFor("tier_threshold", c.id, nextTier.tierNumber)
    keepKeys.add(dedupeKey)
    if (findExistingByDedupe(input.existingAlerts, dedupeKey)) continue

    const meta: TierThresholdMeta & { dedupeKey: string } = {
      contract_name: c.name,
      contract_id: c.id,
      current_spend: c.currentSpend,
      tier_threshold: nextTier.spendMin,
      amount_needed: gap,
      target_tier: nextTier.tierNumber,
      tier_rebate: nextTier.rebateValue,
      dedupeKey,
    }

    create.push({
      portalType: "facility",
      alertType: "tier_threshold",
      title: `Within $${gap.toLocaleString()} of Tier ${nextTier.tierNumber} on "${c.name}"`,
      description: `$${gap.toLocaleString()} more spend unlocks Tier ${nextTier.tierNumber} with ${c.vendorName}.`,
      severity: "medium",
      facilityId: input.facilityId,
      contractId: c.id,
      vendorId: c.vendorId,
      actionLink: `/dashboard/contracts/${c.id}`,
      metadata: meta as unknown as Record<string, unknown>,
      dedupeKey,
    })
  }

  return { create, keepKeys }
}

// ─── Rule 4: rebate_due ──────────────────────────────────────────

function synthRebateDue(input: SynthInput, now: Date): {
  create: SynthAlert[]
  keepKeys: Set<string>
} {
  const create: SynthAlert[] = []
  const keepKeys = new Set<string>()

  for (const p of input.contractPeriods) {
    if (p.rebateEarned <= 0) continue
    if (p.rebateCollected >= p.rebateEarned) continue
    // Past-due: the period has ended on or before `now`.
    if (p.periodEnd.getTime() > now.getTime()) continue

    const dedupeKey = dedupeKeyFor("rebate_due", p.contractId, p.id)
    keepKeys.add(dedupeKey)
    if (findExistingByDedupe(input.existingAlerts, dedupeKey)) continue

    const periodLabel = `${isoDate(p.periodStart)}..${isoDate(p.periodEnd)}`
    const outstanding = p.rebateEarned - p.rebateCollected
    const meta: RebateDueMeta & { dedupeKey: string } = {
      contract_name: p.contractName,
      contract_id: p.contractId,
      vendor_name: p.vendorName,
      amount: outstanding,
      period: periodLabel,
      period_id: p.id,
      dedupeKey,
    }

    create.push({
      portalType: "facility",
      alertType: "rebate_due",
      title: `Rebate due on "${p.contractName}"`,
      description: `$${outstanding.toLocaleString()} in earned rebates pending collection from ${p.vendorName}.`,
      severity: "medium",
      facilityId: input.facilityId,
      contractId: p.contractId,
      vendorId: p.vendorId,
      actionLink: `/dashboard/contracts/${p.contractId}`,
      metadata: meta as unknown as Record<string, unknown>,
      dedupeKey,
    })
  }

  return { create, keepKeys }
}

// ─── Rule 5: payment_due ─────────────────────────────────────────

function synthPaymentDue(input: SynthInput, now: Date): {
  create: SynthAlert[]
  keepKeys: Set<string>
} {
  const create: SynthAlert[] = []
  const keepKeys = new Set<string>()

  const schedules = input.paymentSchedules ?? []
  for (const s of schedules) {
    if (s.paidAt !== null) continue
    const days = daysBetween(s.dueDate, now)
    if (days > PAYMENT_DUE_LEAD_DAYS) continue // too far out yet

    const dedupeKey = dedupeKeyFor("payment_due", s.contractId, s.id)
    keepKeys.add(dedupeKey)
    if (findExistingByDedupe(input.existingAlerts, dedupeKey)) continue

    const severity: SynthAlert["severity"] =
      days <= 0 ? "high" : days <= 3 ? "high" : days <= 7 ? "medium" : "low"

    const meta: PaymentDueMeta & { dedupeKey: string } = {
      contract_name: s.contractName,
      contract_id: s.contractId,
      vendor_name: s.vendorName,
      amount: s.amount,
      due_date: isoDate(s.dueDate),
      dedupeKey,
    }

    create.push({
      portalType: "facility",
      alertType: "payment_due",
      title:
        days < 0
          ? `Payment past due on "${s.contractName}"`
          : `Payment due in ${days} day${days === 1 ? "" : "s"} on "${s.contractName}"`,
      description: `$${s.amount.toLocaleString()} due ${isoDate(s.dueDate)} to ${s.vendorName}.`,
      severity,
      facilityId: input.facilityId,
      contractId: s.contractId,
      vendorId: s.vendorId,
      actionLink: `/dashboard/contracts/${s.contractId}`,
      metadata: meta as unknown as Record<string, unknown>,
      dedupeKey,
    })
  }

  return { create, keepKeys }
}

// ─── Public entrypoint ───────────────────────────────────────────

/**
 * Scan live contract / COG / rebate state and return the alert deltas
 * that should be applied to the DB.
 *
 * @param input.existingAlerts — currently-active (status in ('new_alert','read')) alerts
 *   scoped to this facility. Dismissed + resolved alerts must be EXCLUDED or the
 *   resolver will incorrectly flag them.
 */
export function synthesizeAlertsForFacility(input: SynthInput): SynthResult {
  const now = input.now ?? new Date()

  const off = synthOffContract(input)
  const exp = synthExpiringContract(input, now)
  const tier = synthTierThreshold(input)
  const rebate = synthRebateDue(input, now)
  const payment = synthPaymentDue(input, now)

  const keepKeys = new Set<string>([
    ...off.keepKeys,
    ...exp.keepKeys,
    ...tier.keepKeys,
    ...rebate.keepKeys,
    ...payment.keepKeys,
  ])

  // Any existing alert whose dedupeKey is NOT in keepKeys has no active condition.
  const toResolve: string[] = []
  for (const a of input.existingAlerts) {
    const meta = a.metadata as { dedupeKey?: unknown }
    // Only consider alerts we ourselves synthesize (have a dedupeKey).
    if (typeof meta?.dedupeKey !== "string") continue
    if (!keepKeys.has(meta.dedupeKey)) toResolve.push(a.id)
  }

  const toCreate: SynthAlert[] = [
    ...off.create,
    ...exp.create,
    ...tier.create,
    ...rebate.create,
    ...payment.create,
  ]

  return { toCreate, toResolve }
}
