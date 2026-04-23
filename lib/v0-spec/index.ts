/**
 * v0 spec — reference implementation of Charles's v0 prototype math.
 * Source: `/Users/vickkumar/Downloads/b_T2SEkJJdo8w/docs/`.
 *
 * Each module encodes one family of rules from the docs as pure
 * functions with no I/O. The oracle (`scripts/e2e-synthetic-test.ts`)
 * runs each module's doc examples as ground-truth assertions and, for
 * functions that have tydei counterparts, diffs the two outputs.
 * Divergence = tydei bug, not a spec bug.
 */
export * from "./rebate-math"
export * from "./tie-in"
export * from "./rebate-optimizer"
export * from "./renewals"
export * from "./cog"
export * from "./margins"
export * from "./case-costing"
export * from "./proposal-scoring"
export * from "./invoice-validation"
export * from "./multi-facility"
export * from "./contract-performance"
export * from "./alerts"
