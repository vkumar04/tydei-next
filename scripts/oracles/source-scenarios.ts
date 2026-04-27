// scripts/oracles/source-scenarios.ts
/**
 * Source-scenarios oracle.
 *
 * Imports each scenario, runs it through the source harness, and
 * asserts the scenario's expectations block matches the actuals the
 * contract-detail page would render after the importer + recompute
 * pipeline. Plugs into the existing `bun run oracles` runner.
 */
import { defineOracle } from "./_shared/runner"
import { runScenario, checkExpectations } from "./source/_shared/runner"
import syntheticSpendRebate from "./source/_scenarios/synthetic-spend-rebate"

const SCENARIOS = [syntheticSpendRebate]

export default defineOracle("source-scenarios", async (ctx) => {
  for (const s of SCENARIOS) {
    try {
      const actuals = await runScenario(s)
      for (const r of checkExpectations(actuals, s.expectations)) {
        ctx.check(`[${s.name}] ${r.name}`, r.pass, r.detail)
      }
    } catch (err) {
      ctx.check(
        `[${s.name}] runScenario succeeded`,
        false,
        err instanceof Error ? err.message : String(err),
      )
    }
  }
})
