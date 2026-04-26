/**
 * Stub module for `next/cache` used by tests that exercise server
 * actions touching cache invalidation. Use via:
 *
 *   vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))
 *
 * Vitest's async factory awaits the import before any test code
 * runs, so the same stub shape is shared across every test that
 * opts in. Adding a new `next/cache` export (e.g. when Next 17
 * lands) is a one-line edit here, no test sweep.
 */

import { vi } from "vitest"

export const revalidatePath = vi.fn()
export const revalidateTag = vi.fn()
export const updateTag = vi.fn()

// `unstable_cache` is invoked as `unstable_cache(fn, key, opts)()` —
// the inner fn must still run, so the stub returns it unchanged. (Real
// cache-hit semantics would need integration-level tests with a
// running Next runtime.)
export function unstable_cache<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  return fn
}
