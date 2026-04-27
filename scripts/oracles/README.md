# Oracles

Independent verification of customer-facing numbers. Each oracle in this
folder recomputes some invariant from primary sources (DB, fixture
files) without sharing code with the app's matcher / recompute
pipelines, then compares against the app's output.

## Run

```sh
bun scripts/oracles/index.ts                # every oracle
bun scripts/oracles/index.ts --filter share # only oracles whose name contains "share"
bun run oracles                             # alias for the first form
```

Read-only against whatever `DATABASE_URL` points at. Safe for prod.

## Reports

Every run writes a markdown snapshot to
`docs/superpowers/diagnostics/oracle-runs/<date>-<oracle-name>.md`.
The runner also surfaces drift against the prior baseline (same check
name, different detail) in the console.

## Add a new oracle

Create `scripts/oracles/<name>.ts`:

```ts
import { defineOracle } from "./_shared/runner"

export default defineOracle("<name>", async (ctx) => {
  // ... read primary data, compute the truth, then:
  ctx.check("invariant X holds", computed === expected, `${computed} vs ${expected}`)
})
```

The runner discovers it automatically. Helper paths and demo identifiers
live in `_shared/fixtures.ts` — use them rather than hardcoding.

## Conventions

- One oracle per file. Default-export the `defineOracle(...)` value.
- Keep `check()` names stable across versions — the baseline-diff
  feature matches by name.
- Pure functions only. Don't reuse the app's reducers; the whole point
  is independent compute.

## Files

- `_shared/runner.ts` — `defineOracle` + `runOracle`. Pure TS, unit-tested.
- `_shared/fixtures.ts` — env-var fixture paths + demo facility lookup.
- `_shared/report.ts` — markdown report writer + console summary.
- `_shared/baseline.ts` — diff current run against prior report.
- `index.ts` — entry point. Discovery + `--filter` + exit codes.
- `<name>.ts` — one oracle. Default-exports the `defineOracle(...)` value.
