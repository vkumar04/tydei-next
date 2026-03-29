"use client"

import { useState, useCallback } from "react"
import type { COGRecordInput } from "@/lib/validators/cog-records"

type ImportStep = "upload" | "map" | "preview" | "import"

interface ImportState {
  step: ImportStep
  headers: string[]
  rows: Record<string, string>[]
  mapping: Record<string, string>
  duplicateStrategy: "skip" | "overwrite" | "keep_both"
  mappedRecords: COGRecordInput[]
}

const TARGET_FIELDS = [
  { key: "inventoryNumber", label: "Inventory Number", required: true },
  { key: "inventoryDescription", label: "Description", required: true },
  { key: "vendorName", label: "Vendor Name", required: false },
  { key: "vendorItemNo", label: "Vendor Item No", required: false },
  { key: "manufacturerNo", label: "Manufacturer No", required: false },
  { key: "unitCost", label: "Unit Cost", required: true },
  { key: "extendedPrice", label: "Extended Price", required: false },
  { key: "quantity", label: "Quantity", required: false },
  { key: "transactionDate", label: "Transaction Date", required: true },
  { key: "category", label: "Category", required: false },
] as const

export type TargetField = (typeof TARGET_FIELDS)[number]

export function useCOGImport() {
  const [state, setState] = useState<ImportState>({
    step: "upload",
    headers: [],
    rows: [],
    mapping: {},
    duplicateStrategy: "skip",
    mappedRecords: [],
  })

  const setStep = useCallback((step: ImportStep) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  const setParsedData = useCallback(
    (headers: string[], rows: Record<string, string>[]) => {
      // Auto-map by fuzzy matching header names to target fields
      const autoMapping: Record<string, string> = {}
      for (const field of TARGET_FIELDS) {
        const match = headers.find(
          (h) =>
            h.toLowerCase().replace(/[_\s-]/g, "") ===
            field.key.toLowerCase().replace(/[_\s-]/g, "")
        )
        if (match) autoMapping[field.key] = match
      }
      setState((prev) => ({
        ...prev,
        headers,
        rows,
        mapping: autoMapping,
        step: "map",
      }))
    },
    []
  )

  const setMapping = useCallback((mapping: Record<string, string>) => {
    setState((prev) => ({ ...prev, mapping }))
  }, [])

  const setDuplicateStrategy = useCallback(
    (duplicateStrategy: "skip" | "overwrite" | "keep_both") => {
      setState((prev) => ({ ...prev, duplicateStrategy }))
    },
    []
  )

  const buildRecords = useCallback((): COGRecordInput[] => {
    const { rows, mapping } = state
    return rows
      .map((row) => ({
        inventoryNumber: row[mapping.inventoryNumber ?? ""] ?? "",
        inventoryDescription: row[mapping.inventoryDescription ?? ""] ?? "",
        vendorName: row[mapping.vendorName ?? ""] || undefined,
        vendorItemNo: row[mapping.vendorItemNo ?? ""] || undefined,
        manufacturerNo: row[mapping.manufacturerNo ?? ""] || undefined,
        unitCost: parseFloat(
          (row[mapping.unitCost ?? ""] ?? "0").replace(/[^0-9.-]/g, "")
        ),
        extendedPrice: mapping.extendedPrice
          ? parseFloat(
              (row[mapping.extendedPrice] ?? "0").replace(/[^0-9.-]/g, "")
            )
          : undefined,
        quantity: mapping.quantity
          ? parseInt(row[mapping.quantity] ?? "1", 10)
          : 1,
        transactionDate: row[mapping.transactionDate ?? ""] ?? "",
        category: row[mapping.category ?? ""] || undefined,
      }))
      .filter((r) => r.inventoryNumber && r.inventoryDescription && r.unitCost)
  }, [state])

  const goToPreview = useCallback(() => {
    const records = buildRecords()
    setState((prev) => ({ ...prev, mappedRecords: records, step: "preview" }))
  }, [buildRecords])

  const reset = useCallback(() => {
    setState({
      step: "upload",
      headers: [],
      rows: [],
      mapping: {},
      duplicateStrategy: "skip",
      mappedRecords: [],
    })
  }, [])

  return {
    ...state,
    targetFields: TARGET_FIELDS as unknown as TargetField[],
    setStep,
    setParsedData,
    setMapping,
    setDuplicateStrategy,
    goToPreview,
    reset,
  }
}
