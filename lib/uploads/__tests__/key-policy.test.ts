import { describe, expect, it } from "vitest"
import {
  keyBelongsToTenant,
  keyTenantSegment,
} from "@/lib/uploads/key-policy"
import { createPendingContractSchema } from "@/lib/validators/pending-contracts"

/**
 * Storage-key provenance policy + pending-document validation
 * (security review 2026-08-05). Together these close the
 * self-authorization hole: a submitter could write any guessable key into
 * their own pending contract's documents JSON and later presign it.
 */

describe("keyTenantSegment / keyBelongsToTenant", () => {
  it("extracts the tenant segment from provenance-format keys", () => {
    expect(
      keyTenantSegment("contracts/fac-123/1785145274790-ab12cd34-contract.pdf"),
    ).toBe("fac-123")
    expect(keyTenantSegment("pricing/ven-9/17851-xy-file.xlsx")).toBe("ven-9")
  })

  it("returns null for legacy keys (no tenant segment) and junk", () => {
    // Legacy: <folder>/<timestamp>-<name> — one path level only.
    expect(keyTenantSegment("contracts/1775265753375-CogsART.pdf")).toBeNull()
    expect(keyTenantSegment("contracts/")).toBeNull()
    expect(keyTenantSegment("")).toBeNull()
  })

  it("is folder-agnostic — the AI extract routes mint their own folders", () => {
    expect(keyTenantSegment("amendments/user-7/1785-ab12cd34-amend.pdf")).toBe(
      "user-7",
    )
    expect(
      keyTenantSegment("payor-contracts/user-7/1785-ab12cd34-payor.pdf"),
    ).toBe("user-7")
  })

  it("matches only the caller's own tenant ids", () => {
    const key = "contracts/fac-123/1785145274790-ab12cd34-contract.pdf"
    expect(keyBelongsToTenant(key, ["fac-123"])).toBe(true)
    expect(keyBelongsToTenant(key, ["user-7", "fac-123"])).toBe(true)
    expect(keyBelongsToTenant(key, ["fac-999"])).toBe(false)
    expect(keyBelongsToTenant(key, [])).toBe(false)
    expect(keyBelongsToTenant(key, [undefined, null])).toBe(false)
  })

  it("legacy keys belong to no tenant — new submissions must re-upload", () => {
    expect(
      keyBelongsToTenant("contracts/1775265753375-CogsART.pdf", ["fac-123"]),
    ).toBe(false)
  })
})

describe("pending-contract documents schema (was z.any())", () => {
  const base = {
    vendorId: "ven-1",
    vendorName: "Test Vendor",
    contractName: "Test Agreement",
    contractType: "usage",
  }

  it("accepts storage-key documents", () => {
    const parsed = createPendingContractSchema.safeParse({
      ...base,
      documents: [
        {
          name: "Contract.pdf",
          url: "contracts/ven-1/1785145274790-ab12cd34-Contract.pdf",
          type: "main",
        },
      ],
    })
    expect(parsed.success).toBe(true)
  })

  it("rejects absolute URLs — the stored-phishing vector", () => {
    for (const url of [
      "https://evil.example/login",
      "http://evil.example/x.pdf",
      "javascript:alert(1)",
      "//evil.example/x.pdf",
    ]) {
      const parsed = createPendingContractSchema.safeParse({
        ...base,
        documents: [{ name: "Contract.pdf", url }],
      })
      expect(parsed.success, `should reject ${url}`).toBe(false)
    }
  })

  it("rejects structurally-invalid documents that z.any() accepted", () => {
    const parsed = createPendingContractSchema.safeParse({
      ...base,
      documents: [{ url: 42, nested: { deep: true } }],
    })
    expect(parsed.success).toBe(false)
  })
})
