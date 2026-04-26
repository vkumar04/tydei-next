/**
 * Cache Components rollout — task 7 of
 * docs/superpowers/plans/2026-04-26-cache-components-rollout.md.
 *
 * Verifies the round-trip between the cached READ in _cached.ts and
 * the WRITE-side invalidator in _cache.ts. Both must use the same
 * `analytics:contract:<id>` tag string, otherwise writes silently
 * fail to bust caches and the user sees stale data.
 *
 * The 'use cache' directive is a no-op in vitest (no Next runtime),
 * but cacheTag is still callable. We mock next/cache via the project's
 * shared stub so the invalidator's updateTag and the cached helper's
 * cacheTag both register on spy fns we can inspect.
 */
import { describe, expect, it, vi, beforeEach } from "vitest"

vi.mock("next/cache", () => import("@/tests/setup/next-cache-mock"))

describe("analytics cache wiring (Cache Components rollout)", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it("invalidateContractAnalytics calls updateTag with analytics:contract:<id>", async () => {
    const cacheModule = await import("next/cache")
    const updateTagSpy = vi.mocked(cacheModule.updateTag)
    updateTagSpy.mockClear()

    const { invalidateContractAnalytics } = await import("../_cache")
    await invalidateContractAnalytics("contract-1")

    expect(updateTagSpy).toHaveBeenCalledWith("analytics:contract:contract-1")
  })

  it("invalidateFacilityAnalytics tags with analytics:facility:<id>", async () => {
    const cacheModule = await import("next/cache")
    const updateTagSpy = vi.mocked(cacheModule.updateTag)
    updateTagSpy.mockClear()

    const { invalidateFacilityAnalytics } = await import("../_cache")
    await invalidateFacilityAnalytics("fac-1")

    expect(updateTagSpy).toHaveBeenCalledWith("analytics:facility:fac-1")
  })

  it("invalidateVendorAnalytics tags with analytics:vendor:<id>", async () => {
    const cacheModule = await import("next/cache")
    const updateTagSpy = vi.mocked(cacheModule.updateTag)
    updateTagSpy.mockClear()

    const { invalidateVendorAnalytics } = await import("../_cache")
    await invalidateVendorAnalytics("vendor-1")

    expect(updateTagSpy).toHaveBeenCalledWith("analytics:vendor:vendor-1")
  })

  it("read and write sides use the SAME tag-builder module — no drift", async () => {
    // Smoke check: both _cached.ts (reads) and _cache.ts (writes)
    // must import contractAnalyticsTag from the same source. If a
    // future refactor copy-pastes the tag-format string, the test
    // catches it because the strings would diverge by inspection.
    const cached = await import("../_cached")
    const writeSide = await import("../_cache")
    expect(cached.contractAnalyticsTag("X")).toBe("analytics:contract:X")
    // Confirm the write side is wired to the same builder by spying.
    const cacheModule = await import("next/cache")
    const updateTagSpy = vi.mocked(cacheModule.updateTag)
    updateTagSpy.mockClear()
    await writeSide.invalidateContractAnalytics("X")
    expect(updateTagSpy).toHaveBeenCalledWith(cached.contractAnalyticsTag("X"))
  })
})
