/**
 * Shape tests for the vendor-proposal where-fragments — the Alert side
 * (lib/alerts/vendor-proposal-filter.ts) and the PendingContract side
 * (lib/prospective/proposal-rows.ts). Pins the Prisma JSON null-
 * semantics OR (mirrors spend-target-filter): a naive NOT-equals
 * filter silently excludes every row whose metadata lacks the key.
 */
import { describe, it, expect } from "vitest"
import { Prisma } from "@/lib/generated/prisma/client"
import {
  excludeVendorProposalAlerts,
  onlyVendorProposalAlerts,
} from "../vendor-proposal-filter"
import {
  excludeProspectiveProposalRows,
  onlyProspectiveProposalRows,
} from "@/lib/prospective/proposal-rows"

describe("excludeVendorProposalAlerts", () => {
  it("is the OR of 'path missing' and 'path differs' (never naive NOT-equals)", () => {
    expect(excludeVendorProposalAlerts()).toEqual({
      OR: [
        { metadata: { path: ["type"], equals: Prisma.AnyNull } },
        { metadata: { path: ["type"], not: "vendor_proposal" } },
      ],
    })
  })
})

describe("onlyVendorProposalAlerts", () => {
  it("matches only rows discriminated as vendor proposals", () => {
    expect(onlyVendorProposalAlerts()).toEqual({
      metadata: { path: ["type"], equals: "vendor_proposal" },
    })
  })
})

describe("onlyProspectiveProposalRows", () => {
  it("requires draft status AND the pricingData kind discriminator", () => {
    expect(onlyProspectiveProposalRows()).toEqual({
      status: "draft",
      pricingData: { path: ["kind"], equals: "vendor_proposal" },
    })
  })
})

describe("excludeProspectiveProposalRows", () => {
  it("uses the same null-semantics OR shape on pricingData.kind", () => {
    expect(excludeProspectiveProposalRows()).toEqual({
      OR: [
        { pricingData: { path: ["kind"], equals: Prisma.AnyNull } },
        { pricingData: { path: ["kind"], not: "vendor_proposal" } },
      ],
    })
  })
})
