import { describe, it, expect, vi } from "vitest"

// Mock Next.js navigation hooks (client-only)
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

// Mock server-action modules that transitively pull in Stripe/auth/prisma
vi.mock("@/lib/auth-server", () => ({}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: vi.fn(),
  requireVendor: vi.fn(),
  requireAdmin: vi.fn(),
}))
vi.mock("@/lib/actions/contracts", () => ({
  createContractDocument: vi.fn(),
}))
vi.mock("@/lib/actions/contract-terms", () => ({
  createContractTerm: vi.fn(),
}))
vi.mock("@/lib/actions/pricing-files", () => ({
  importContractPricing: vi.fn(),
}))
vi.mock("@/lib/actions/categories", () => ({
  createCategory: vi.fn(),
  getCategories: vi.fn(),
}))
vi.mock("@/lib/actions/cog-records", () => ({
  computePricingVsCOG: vi.fn(),
}))
vi.mock("@/lib/actions/contracts/derive-from-cog", () => ({
  deriveContractTotalFromCOG: vi.fn(),
}))
vi.mock("@/lib/actions/vendors", () => ({
  createVendor: vi.fn(),
}))

import { initialEntryMode } from "@/components/contracts/new-contract-client"

describe("initialEntryMode", () => {
  it("defaults to pdf when param is missing", () => {
    expect(initialEntryMode(null)).toBe("pdf")
  })
  it("respects ?mode=manual / ?mode=ai", () => {
    expect(initialEntryMode("manual")).toBe("manual")
    expect(initialEntryMode("ai")).toBe("ai")
  })
  it("falls back to pdf for unknown values", () => {
    expect(initialEntryMode("garbage")).toBe("pdf")
  })
})
