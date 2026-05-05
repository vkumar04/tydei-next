# Audit — Oracle sweep after per-type-engine wiring (2026-05-05)

## Why

Confirm no math drift was introduced by the per-type rebate-engine
wirings landed in commits `ec5c14f..8df905c`.

## Method

Ran `bun scripts/oracles/index.ts` against the local Postgres
(`docker exec tydei-next-postgres-1`, same instance as
`postgresql://tydei:tydei_dev_password@localhost:5432/tydei`).

The runner discovers every `.ts` under `scripts/oracles/` (excluding
`_shared/` and `index.ts`), runs each, writes a per-oracle report under
`docs/superpowers/diagnostics/oracle-runs/` (gitignored), and exits
non-zero on any failure.

Process exit: `0` (all oracles green).

Note: invoking the oracle files individually (`bun run
scripts/oracles/<name>.ts`) is a no-op — they default-export an
`OracleDefinition` and only run when the index entry point imports and
invokes them. The audit prompt's per-oracle `for` loop would have
silently passed every oracle without checking anything; the runner
entry point above is the correct invocation.

## Results

| Oracle | Pass/Fail | Checks | Duration | Drift vs prior baseline |
|---|---|---|---|---|
| `full-sweep` | PASS | 12/12 | 42 ms | Off-contract spend amount changed (data shifted), oracle and app still equal |
| `capital-amortization` | PASS | 24/24 | 0 ms | none |
| `charles-2026-04-28-fixes` | PASS | 7/7 | 0 ms | none |
| `cog-in-term-scope` | PASS | 12/12 | 0 ms | none |
| `market-share` | PASS | 5/5 | 73 ms | `totalVendorSpend` 2,099,700 → 2,107,600 (data drift, app and oracle still equal) |
| `rebate-forecast` | PASS | 18/18 | 1 ms | none |
| `schema-invariants` | PASS | 15/15 | 19 ms | rebate-row count grew 152 → 169 (more accruals seeded — informational, not a failure) |
| `source-scenarios` | PASS | 11/11 | 322 ms | none |
| `ytd-earned` | PASS | 3/3 | 9 ms | none |
| `ytd-earned-engine` | PASS | 5/5 | 0 ms | none |

**Totals: 10/10 oracles green, 112/112 checks green.**

## Drift interpretation

The four "drift vs prior baseline" lines all reflect the **data**
changing between sweeps (more rebate rows seeded, totals shifted), not
the **math** changing. In every case the oracle's recomputed value and
the application's reported value still agree to the penny — that's the
invariant the oracle actually enforces. If the math had drifted the
parity check itself would have failed and the oracle would be red.

Specifically for the rebate-engine wiring concern:

- `full-sweep` recomputes cumulative + marginal rebate math from scratch
  via the pure `calculate*` engine and compares against persisted
  `Rebate` rows / app aggregates. 12/12 green means
  `scaleRebateValueForEngine` is converting fractional `rebateValue`
  (0.02 → 2) correctly at the boundary.
- `capital-amortization` recomputes per-period principal / interest
  splits and the `sumRebateAppliedToCapital` tie-in — 24/24 green
  means the rebate-applied-to-capital filter still ties to the engine
  output.
- `source-scenarios` runs five synthetic end-to-end scenarios
  (importer → recompute pipeline) and verifies aggregates after the
  full pipeline — 11/11 green means the engine integrates cleanly
  with the bulk-import + match path.

## Conclusion

No math drift introduced by `ec5c14f..8df905c`. The per-type engine
wiring is consistent with every existing invariant the oracle suite
guards.

## Reproducibility

```bash
cd /Users/vickkumar/code/tydei-next
bun scripts/oracles/index.ts                    # all oracles
bun scripts/oracles/index.ts --filter full-sweep # one oracle
```
