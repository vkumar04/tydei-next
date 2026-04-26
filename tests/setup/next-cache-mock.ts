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

// 2026-04-26: Cache Components rollout — `'use cache'` is a directive,
// not a callable, but the tests still need cacheLife / cacheTag to
// import without crashing. Both are no-op spies; the function bodies
// they're called from still execute under vitest because '"use cache"'
// has no effect outside the Next runtime.
export const cacheLife = vi.fn()
export const cacheTag = vi.fn()

// `unstable_cache` is invoked as `unstable_cache(fn, key, opts)()` —
// the inner fn must still run, so the stub returns it unchanged. (Real
// cache-hit semantics would need integration-level tests with a
// running Next runtime.)
export function unstable_cache<TArgs extends unknown[], TReturn>(
  fn: (...args: TArgs) => TReturn,
): (...args: TArgs) => TReturn {
  return fn
}
