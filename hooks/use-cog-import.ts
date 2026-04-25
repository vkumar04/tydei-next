"use client"

import { useState, useCallback } from "react"
import type { COGRecordInput } from "@/lib/validators/cog-records"
import { mapColumns } from "@/lib/map-columns"

type ImportStep = "upload" | "mapping" | "map" | "vendor_match" | "duplicate_check" | "preview" | "import"

interface ImportState {
  step: ImportStep
  headers: string[]
  rows: Record<string, string>[]
  mapping: Record<string, string>
  duplicateStrategy: "skip" | "overwrite" | "keep_both"
  mappedRecords: COGRecordInput[]
  vendorMappings: Record<string, string>
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
  // Charles iMessage 2026-04-20 N6: "The multiplier is not in the
  // mapping screens and everything is x1 when I know on the COGs many
  // are not just x1." When mapped, the parser multiplies extendedPrice
  // by this value — the COG table's Multiplier column (which computes
  // extended / (unitCost × quantity)) then renders the real multiplier
  // instead of always-1.00×.
  { key: "multiplier", label: "Multiplier (case pack / units per line)", required: false },
  { key: "transactionDate", label: "Transaction Date", required: true },
  { key: "category", label: "Category", required: false },
  // Charles iMessage 2026-04-20 N9: "PO number needs to be a part of
  // the mapping columns here as well when the file is loading." The
  // backend parser already accepts poNumber and the COGRecord row has
  // the column — just wasn't exposed in the UI.
  { key: "poNumber", label: "Purchase Order Number", required: false },
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
    vendorMappings: {},
  })

  const setStep = useCallback((step: ImportStep) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  const setParsedData = useCallback(
    async (headers: string[], rows: Record<string, string>[]) => {
      // Show loading state while Gemini maps columns
      setState((prev) => ({
        ...prev,
        headers,
        rows,
        step: "mapping",
      }))

      try {
        const mapping = await mapColumns(headers, [...TARGET_FIELDS], rows)
        setState((prev) => ({
          ...prev,
          mapping,
          step: "map",
        }))
      } catch {
        // If AI fails, proceed to manual mapping with empty mapping
        setState((prev) => ({
          ...prev,
          mapping: {},
          step: "map",
        }))
      }
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
      .map((row) => {
        const rawQty = mapping.quantity
          ? parseInt(row[mapping.quantity] ?? "", 10)
          : 1
        const qty = Number.isFinite(rawQty) && rawQty >= 1 ? rawQty : 1

        const rawUnitCost = parseFloat(
          (row[mapping.unitCost ?? ""] ?? "0").replace(/[^0-9.-]/g, "")
        )
        const unitCost = Number.isFinite(rawUnitCost) ? rawUnitCost : 0

        let extendedPrice: number | undefined
        if (mapping.extendedPrice) {
          const rawExt = parseFloat(
            (row[mapping.extendedPrice] ?? "0").replace(/[^0-9.-]/g, "")
          )
          extendedPrice = Number.isFinite(rawExt) && rawExt !== 0 ? rawExt : undefined
        }
        // Fallback: calculate extendedPrice from unitCost * quantity when not provided
        if (extendedPrice === undefined && unitCost > 0) {
          extendedPrice = unitCost * qty
        }

        // Normalise the transaction date to ISO format so the server can parse it
        const rawDate = (row[mapping.transactionDate ?? ""] ?? "").trim()
        let transactionDate = rawDate
        if (rawDate) {
          const d = new Date(rawDate)
          if (!isNaN(d.getTime())) {
            transactionDate = d.toISOString().slice(0, 10) // YYYY-MM-DD
          }
        }

        return {
          inventoryNumber: row[mapping.inventoryNumber ?? ""] ?? "",
          inventoryDescription: row[mapping.inventoryDescription ?? ""] ?? "",
          vendorName: row[mapping.vendorName ?? ""] || undefined,
          vendorItemNo: row[mapping.vendorItemNo ?? ""] || undefined,
          manufacturerNo: row[mapping.manufacturerNo ?? ""] || undefined,
          unitCost,
          extendedPrice,
          quantity: qty,
          transactionDate,
          category: row[mapping.category ?? ""] || undefined,
          // Charles 2026-04-25: PO number was being silently dropped here
          // even when the user mapped it; the mapping was discoverable
          // (TARGET_FIELDS exposes it) but the projection didn't read it.
          poNumber: row[mapping.poNumber ?? ""] || undefined,
        }
      })
      .filter(
        (r) =>
          r.inventoryNumber &&
          r.inventoryDescription &&
          r.unitCost > 0 &&
          r.transactionDate
      )
  }, [state])

  const setVendorMappings = useCallback(
    (vendorMappings: Record<string, string>) => {
      setState((prev) => ({ ...prev, vendorMappings }))
    },
    []
  )

  /** After column mapping, go to vendor match (if vendor names exist) or duplicate check */
  const goToVendorMatch = useCallback(() => {
    const records = buildRecords()
    const hasVendorNames = records.some((r) => r.vendorName)
    setState((prev) => ({
      ...prev,
      mappedRecords: records,
      step: hasVendorNames ? "vendor_match" : "duplicate_check",
    }))
  }, [buildRecords])

  /** After vendor matching, proceed to duplicate check */
  const goToDuplicateCheck = useCallback(() => {
    setState((prev) => {
      // Apply vendor IDs from vendorMappings to mappedRecords
      const updated = prev.mappedRecords.map((r) => {
        if (r.vendorName && prev.vendorMappings[r.vendorName]) {
          return { ...r, vendorId: prev.vendorMappings[r.vendorName] }
        }
        return r
      })
      return { ...prev, mappedRecords: updated, step: "duplicate_check" }
    })
  }, [])

  const setMappedRecords = useCallback((records: COGRecordInput[]) => {
    setState((prev) => ({ ...prev, mappedRecords: records }))
  }, [])

  const goToPreview = useCallback(() => {
    setState((prev) => ({ ...prev, step: "preview" }))
  }, [])

  const reset = useCallback(() => {
    setState({
      step: "upload",
      headers: [],
      rows: [],
      mapping: {},
      duplicateStrategy: "skip",
      mappedRecords: [],
      vendorMappings: {},
    })
  }, [])

  return {
    ...state,
    targetFields: TARGET_FIELDS as unknown as TargetField[],
    setStep,
    setParsedData,
    setMapping,
    setDuplicateStrategy,
    setVendorMappings,
    setMappedRecords,
    goToVendorMatch,
    goToDuplicateCheck,
    goToPreview,
    reset,
  }
}
