# Subsystem 7 — Tie-In Contract Engine (Contracts Rewrite)

**Goal:** Implement the three compliance modes for bundled contracts per spec section 4. Schema was added in subsystem 0 (TieInBundle, TieInBundleMember). Bundle-editor UI + bundle detail card deferred to subsystem 8.

**Priority:** P0 — tie-in is a stub in tydei today. `contractType === 'tie_in'` is accepted by the form but no downstream math handles it.

**Parent spec:** `docs/superpowers/specs/2026-04-18-contracts-rewrite.md`

## Files

- Create: `lib/contracts/tie-in.ts`:
  - `evaluateAllOrNothing(members, performance, { bonusMultiplier? })` — every member must hit its minimumSpend; on full compliance, apply the bonus multiplier to the base rebate. On any miss, base rebate only and list of failing members.
  - `evaluateProportional(members, performance)` — each member's compliance % is capped at 100 and weighted by `weightPercent`; sum across members gives bundle compliance %. No bonus math — the base rebate is the total of member rebates.
  - `evaluateCrossVendor(members, performance, { bonusMultiplier?, facilityBonusPercent? })` — composes all-or-nothing with an additive facility bonus percent on top when every vendor is compliant.
- Create: `tests/contracts/tie-in.test.ts` — 8 tests covering:
  - All-or-nothing compliant with bonus multiplier
  - All-or-nothing non-compliant → zero bonus + failingMembers list
  - Default multiplier (missing opt) → zero bonus even when compliant
  - Proportional: weighted split (81% example)
  - Proportional 100%: compliant
  - Proportional: individual caps at 100% (3× min doesn't over-count)
  - Cross-vendor with facility bonus when all compliant
  - Cross-vendor zero facility bonus when any non-compliant

## Types

```ts
interface TieInMember { contractId: string; weightPercent: number; minimumSpend?: number | null }
interface MemberPerformance { contractId: string; currentSpend: number; currentRebate: number }
type ComplianceStatus = "compliant" | "non_compliant" | "partial"
```

## Acceptance

- `bunx vitest run tests/contracts/tie-in.test.ts` → 8/8 passing
- `bunx tsc --noEmit` → 0 errors
- Engine-only commit; bundle CRUD UI + compliance card come in subsystem 8.
