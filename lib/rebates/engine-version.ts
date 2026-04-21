/**
 * Engine version constant — bump on every math-affecting change.
 *
 * Roadmap track 2: every `Rebate` row written by the accrual pipeline
 * carries the engine version that computed it. When the math changes,
 * old rows stay stamped with the old version; a targeted recompute can
 * upgrade them deterministically.
 *
 * When to bump:
 *   - Tier math semantics change (e.g. 2026-04-20 below-baseline fix).
 *   - Accrual windowing changes (e.g. 2026-04-20 period-reset rule).
 *   - Canonical helper output shapes change (sumRebateAppliedToCapital,
 *     sumCollectedRebates, etc.).
 *
 * When NOT to bump:
 *   - UI labels / copy changes.
 *   - New engine features behind a flag (until they become the default).
 *   - Bug fixes that only affect previously-0 outputs (no data moves).
 *
 * Convention: `vN` where N is an increasing integer. Keep the history
 * below as a changelog so reviewers can see what each bump implied.
 *
 * History:
 *   v1 — 2026-04-20. First stamped engine. Includes:
 *        - Below-baseline returns zero (eec04c4 / 841357c).
 *        - Period-reset tier qualification (5b06bd5).
 *        - Canonical paidToDate routing through sumRebateAppliedToCapital.
 *        - Legacy rebate-method.ts deleted; all callers on
 *          lib/rebates/engine/ via the lib/rebates/calculate.ts shim.
 */
export const ENGINE_VERSION = "v1"
