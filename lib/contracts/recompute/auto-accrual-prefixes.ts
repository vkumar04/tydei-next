/**
 * Single source of truth for every system-generated Rebate `notes`
 * prefix. Each accrual writer stamps its rows with its own prefix so
 * idempotent re-runs can wipe ONLY what that writer owns:
 *
 *   - `[auto-accrual]`            spend writer (recompute-accrual.ts)
 *   - `[auto-threshold-accrual]`  compliance_rebate / market_share
 *   - `[auto-volume-accrual]`     volume_rebate / rebate_per_use /
 *                                 capitated_pricing_rebate
 *   - `[auto-carve-out-accrual]`  carve_out
 *   - `[auto-po-accrual]`         po_rebate
 *   - `[auto-invoice-accrual]`    payment_rebate
 *
 * bugs.rtfd 2026-06-12 R1: the prefixes used to live as private consts
 * in each writer, and `recomputeAccrualForContract`'s upfront wipe only
 * deleted the spend writer's `[auto-accrual]` prefix. A term-type edit
 * (market_share → volume_rebate) therefore orphaned the previous
 * writer's rows FOREVER — no writer ran for the old type anymore, so
 * nothing ever deleted them — double-counting every aggregate
 * (volume math 38,775 + stale threshold 26,751 = 65,526). The full
 * family list below lets the upfront wipe cover every writer's rows;
 * each writer still imports its own prefix from here so the strings
 * cannot drift.
 *
 * NOTE: manually-entered rebate rows never carry any of these prefixes
 * and must never match a wipe filter.
 */
export const AUTO_ACCRUAL_PREFIX = "[auto-accrual]"
export const AUTO_THRESHOLD_PREFIX = "[auto-threshold-accrual]"
export const AUTO_VOLUME_PREFIX = "[auto-volume-accrual]"
export const AUTO_CARVE_OUT_PREFIX = "[auto-carve-out-accrual]"
export const AUTO_PO_PREFIX = "[auto-po-accrual]"
export const AUTO_INVOICE_PREFIX = "[auto-invoice-accrual]"

/**
 * Every prefix any accrual writer has ever stamped. Used by the
 * recompute entry point's upfront wipe so rows persisted by a writer
 * the contract's terms no longer route to are still cleaned up.
 */
export const AUTO_ACCRUAL_PREFIXES = [
  AUTO_ACCRUAL_PREFIX,
  AUTO_THRESHOLD_PREFIX,
  AUTO_VOLUME_PREFIX,
  AUTO_CARVE_OUT_PREFIX,
  AUTO_PO_PREFIX,
  AUTO_INVOICE_PREFIX,
] as const
