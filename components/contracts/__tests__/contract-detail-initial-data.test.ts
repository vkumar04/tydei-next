/**
 * Regression test — W2.A.5 "Current Spend (Last 12 Months)" flicker.
 *
 * Charles reported that the contract-detail header card briefly rendered
 * `$0` on first load before swapping to the real trailing-12mo spend
 * number. Root cause (H1 / H4): `ContractDetailClient` is a pure client
 * component that fetches the contract via `useContract` after mount,
 * so the initial paint had `isLoading: true` / cached-miss and the
 * `stats.totalSpend` fell through to `0` via `Number(undefined ?? 0)`
 * on any downstream surface that peeked at the partial shape.
 *
 * Fix: the server component (`app/dashboard/contracts/[id]/page.tsx`)
 * now pre-fetches the contract server-side and threads it down as
 * `initialContract`, which `useContract` passes into React Query's
 * `initialData` so the first render already has the real numbers.
 *
 * This test is a source-shape guard: since vitest runs in a node
 * environment (no jsdom) we can't render React here. Instead we
 * verify the wiring that prevents the flicker stays in place:
 *
 *  1. The server page imports `getContract` and forwards the result
 *     as `initialContract`.
 *  2. The client component accepts `initialContract` and passes it
 *     to `useContract` as `initialData`.
 *  3. The hook forwards `initialData` to `useQuery`.
 *
 * If any of these links break, the flicker returns.
 */
import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const REPO_ROOT = join(__dirname, "..", "..", "..")

function read(relPath: string): string {
  return readFileSync(join(REPO_ROOT, relPath), "utf8")
}

describe("W2.A.5 — contract-detail initialData wiring", () => {
  it("server page pre-fetches the contract and passes it as initialContract", () => {
    const src = read("app/dashboard/contracts/[id]/page.tsx")
    // Server-side fetch happens before rendering the client.
    expect(src).toMatch(/getContract\s*\(/)
    // The result is forwarded as `initialContract=`.
    expect(src).toMatch(/initialContract\s*=\s*\{/)
  })

  it("ContractDetailClient accepts initialContract and pipes it into useContract", () => {
    const src = read("components/contracts/contract-detail-client.tsx")
    // Prop name on the client component.
    expect(src).toMatch(/initialContract\?:/)
    // useContract is called with the initialData option sourced from
    // the prop so React Query's cache is seeded on first render.
    expect(src).toMatch(/useContract\([\s\S]*?initialData:\s*initialContract/)
  })

  it("useContract threads initialData into useQuery", () => {
    const src = read("hooks/use-contracts.ts")
    // The hook signature accepts an options bag with initialData.
    expect(src).toMatch(/options\?:\s*\{\s*initialData\?:/)
    // And forwards it to useQuery — so the first render is a cache hit.
    expect(src).toMatch(/initialData:\s*periodId\s*\?\s*undefined\s*:\s*options\?\.initialData/)
  })
})
