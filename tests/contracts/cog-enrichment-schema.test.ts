import { describe, it, expect } from "vitest"
import type {
  COGMatchStatus,
  FileImportType,
  FileImportStatus,
  COGRecord,
  FileImport,
} from "@prisma/client"

describe("COGMatchStatus enum", () => {
  it("exposes the 6 canonical status values", () => {
    // Compile-time check: if any value is missing from the generated enum,
    // this file will fail to compile.
    const values: COGMatchStatus[] = [
      "pending",
      "on_contract",
      "off_contract_item",
      "out_of_scope",
      "unknown_vendor",
      "price_variance",
    ]
    expect(values).toHaveLength(6)
  })
})

describe("FileImportType enum", () => {
  it("exposes the 3 canonical file-import types", () => {
    const values: FileImportType[] = ["cog", "pricing", "invoice"]
    expect(values).toHaveLength(3)
  })
})

describe("FileImportStatus enum", () => {
  it("exposes the 3 canonical status values", () => {
    const values: FileImportStatus[] = ["processing", "completed", "failed"]
    expect(values).toHaveLength(3)
  })
})

describe("COGRecord enrichment shape", () => {
  it("surfaces the 6 new enrichment columns in the generated type", () => {
    // Compile-time shape assertion — if any field is missing from the
    // generated Prisma model, this object literal will fail to typecheck.
    const _shape: Pick<
      COGRecord,
      | "contractId"
      | "contractPrice"
      | "isOnContract"
      | "savingsAmount"
      | "variancePercent"
      | "fileImportId"
      | "matchStatus"
    > = {
      contractId: null,
      contractPrice: null,
      isOnContract: false,
      savingsAmount: null,
      variancePercent: null,
      fileImportId: null,
      matchStatus: "pending",
    }
    expect(_shape.isOnContract).toBe(false)
    expect(_shape.matchStatus).toBe("pending")
  })
})

describe("FileImport shape", () => {
  it("exposes the file-level import batch columns", () => {
    // Compile-time shape assertion against the generated model.
    const _shape: Pick<
      FileImport,
      | "fileType"
      | "fileName"
      | "recordCount"
      | "onContractSpend"
      | "offContractSpend"
      | "totalSavings"
      | "matchedRecords"
      | "unmatchedRecords"
      | "uniqueVendors"
      | "uniqueItems"
      | "errorCount"
      | "warningCount"
      | "processingDurationMs"
      | "status"
    > = {
      fileType: "cog",
      fileName: "example.csv",
      recordCount: null,
      onContractSpend: null,
      offContractSpend: null,
      totalSavings: null,
      matchedRecords: null,
      unmatchedRecords: null,
      uniqueVendors: null,
      uniqueItems: null,
      errorCount: 0,
      warningCount: 0,
      processingDurationMs: null,
      status: "processing",
    }
    expect(_shape.errorCount).toBe(0)
    expect(_shape.warningCount).toBe(0)
    expect(_shape.status).toBe("processing")
  })
})
