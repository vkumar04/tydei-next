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
 *   - "unwired"    — engine exists but no display-facing action reaches
 *                    it. See `docs/superpowers/audits/2026-04-19-engine-param-coverage.md`.
 *                    (Per the audit resolution, the `calculateRebate`
 *                    dispatcher and `buildConfigFromPrismaTerm` bridge
 *                    were removed — so "dispatched" is no longer a
 *                    valid status. Every engine calculator is either
 *                    directly invoked by an action ("wired"),
 *                    structurally unreachable from production
 *                    ("unwired"), or composed by another engine
 *                    ("internal").)
 *   - "internal"   — consumed by other engines (capitated, tie-in-capital)
 *                    rather than by actions directly.
 */
import { describe, it, expect } from "vitest"

type WiringStatus = "wired" | "unwired" | "internal"

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
    status: "unwired",
    note: "No action constructs CAPITATED config today. The calculateRebate dispatcher was removed as part of the 2026-04-19 engine-param-coverage audit resolution; the per-type calculator is still exported but unreachable from the display path until a future action adopts it.",
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
    status: "unwired",
    note: "No server action imports calculateSpendRebate directly. Display surfaces use lib/contracts/rebate-accrual-schedule.ts and lib/rebates/calculate.ts#computeRebateFromPrismaTiers. The old dispatcher bridge (computeRebateFromPrismaTerm / buildConfigFromPrismaTerm) was removed per the 2026-04-19 engine-param-coverage audit resolution.",
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
    status: "wired",
    note: "Reachable via getTierPriceReductionForContract in lib/actions/contracts/tier-price-reduction.ts; routes through calculateRebate dispatcher + buildRebateConfigFromPrisma. No UI consumer yet — engine is invocable from any future caller.",
  },
  {
    fn: "calculateVolumeRebate",
    source: "lib/rebates/engine/volume-rebate.ts",
    status: "unwired",
    note: "No action constructs VolumeRebateConfig directly. The old dispatcher path via computeRebateFromPrismaTerm was removed per the 2026-04-19 engine-param-coverage audit resolution; volume-rebate accrual still flows through lib/contracts/rebate-accrual-schedule.ts.",
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
      expect(["wired", "unwired", "internal"]).toContain(status)
      expect(note.length).toBeGreaterThan(10)
    },
  )
})
