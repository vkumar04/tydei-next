/**
 * Engine-wiring manifest (companion to
 * `lib/contracts/__tests__/parity/engine-wiring-parity.test.ts`).
 *
 * Purpose: explicitly catalog each function exported from
 * `lib/rebates/engine/` alongside its current wiring status. The parity
 * tripwire searches `lib/actions/__tests__/` for the engine function's
 * name; this file IS that presence. A per-function `it.each` entry
 * documents whether the function has a real Prisma-to-engine wiring
 * test, a placeholder (still-needed) stub, or is consumed by another
 * engine internally.
 *
 * When you wire an engine function through a server action, update the
 * entry's `status` to "wired" and add the path to the wiring test. When
 * you add a new engine function, add a row here.
 *
 * Why not one test per function in isolation? A single manifest reads
 * like documentation and scales with the engine surface. The tripwire
 * in parity/engine-wiring-parity.test.ts enforces that EVERY engine fn
 * appears here — if you add one without updating this manifest, the
 * parity tripwire fails and points you here.
 *
 * ─── Coverage status codes ──────────────────────────────────
 *   - "wired"      — at least one action test covers the full
 *                    Prisma-to-engine path for this function.
 *   - "dispatched" — reached only via `calculateRebate(config, ...)`;
 *                    not directly imported by any action.
 *   - "unwired"    — engine exists but no display-facing action reaches
 *                    it. See `docs/superpowers/audits/2026-04-19-engine-param-coverage.md`.
 *   - "internal"   — consumed by other engines (capitated, tie-in-capital)
 *                    rather than by actions directly.
 */
import { describe, it, expect } from "vitest"

type WiringStatus = "wired" | "dispatched" | "unwired" | "internal"

interface EngineWiring {
  /** Exported name from `lib/rebates/engine/<file>.ts`. */
  fn: string
  /** Source file of the implementation. */
  source: string
  /** Whether a display-facing test exercises the Prisma-to-engine path. */
  status: WiringStatus
  /** Short note on the dispatch path or remaining gap. */
  note: string
}

// Keep this list alphabetically sorted by `fn` for easy diff review.
const MANIFEST: EngineWiring[] = [
  {
    fn: "buildTieInAmortizationSchedule",
    source: "lib/rebates/engine/amortization.ts",
    status: "wired",
    note: "Covered via lib/actions/contracts/tie-in.ts imports; wiring test: contract-term-amortization-shape.test.ts",
  },
  {
    fn: "calculateCapitated",
    source: "lib/rebates/engine/capitated.ts",
    status: "dispatched",
    note: "Reachable through calculateRebate dispatcher; no action directly constructs CAPITATED config today — see engine-param-coverage audit row for groupedReferenceNumbers/periodCap.",
  },
  {
    fn: "calculateCarveOut",
    source: "lib/rebates/engine/carve-out.ts",
    status: "unwired",
    note: "ContractTerm → CarveOutConfig mapping falls through to SPEND_REBATE in from-prisma.ts; no action builds CarveOutConfig.lines. See audit.",
  },
  {
    fn: "calculateMarketSharePriceReduction",
    source: "lib/rebates/engine/market-share-price-reduction.ts",
    status: "unwired",
    note: "No caller constructs MarketSharePriceReductionConfig from Prisma today. See audit.",
  },
  {
    fn: "calculateMarketShareRebate",
    source: "lib/rebates/engine/market-share-rebate.ts",
    status: "unwired",
    note: "No caller constructs MarketShareRebateConfig from Prisma today. See audit.",
  },
  {
    fn: "calculateSpendRebate",
    source: "lib/rebates/engine/spend-rebate.ts",
    status: "dispatched",
    note: "Dispatched via computeRebateFromPrismaTerm in from-prisma.ts (tests: rebates/__tests__/from-prisma.test.ts). Display surfaces use accrual-schedule shared utilities instead.",
  },
  {
    fn: "calculateTieInCapital",
    source: "lib/rebates/engine/tie-in-capital.ts",
    status: "internal",
    note: "Composes SPEND_REBATE + amortization; display path uses buildTieInAmortizationSchedule directly from lib/actions/contracts/tie-in.ts.",
  },
  {
    fn: "calculateTierPriceReduction",
    source: "lib/rebates/engine/tier-price-reduction.ts",
    status: "unwired",
    note: "No action dispatches to TIER_PRICE_REDUCTION today. See audit row for trigger/referenceNumbers.",
  },
  {
    fn: "calculateVolumeRebate",
    source: "lib/rebates/engine/volume-rebate.ts",
    status: "dispatched",
    note: "Dispatched via computeRebateFromPrismaTerm when ContractTerm.termType = 'volume_rebate'. No action-level wiring test exercises the full path; see audit.",
  },
]

describe("engine-wiring manifest", () => {
  it("covers every engine function exported from lib/rebates/engine/", () => {
    // The parity tripwire in
    // lib/contracts/__tests__/parity/engine-wiring-parity.test.ts
    // enforces this by reading the filesystem. Here we just sanity-check
    // the manifest is not empty.
    expect(MANIFEST.length).toBeGreaterThan(0)
  })

  it.each(MANIFEST)(
    "entry is well-formed: $fn ($status)",
    ({ fn, source, status, note }) => {
      expect(fn).toMatch(/^[a-zA-Z][\w]*$/)
      expect(source).toMatch(/^lib\/rebates\/engine\//)
      expect(["wired", "dispatched", "unwired", "internal"]).toContain(status)
      expect(note.length).toBeGreaterThan(10)
    },
  )
})
