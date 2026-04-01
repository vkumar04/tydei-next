"use client"

import { useState, useCallback } from "react"
import type { PricingFileInput } from "@/lib/validators/pricing-files"
import { mapColumns } from "@/lib/map-columns"

type ImportStep = "upload" | "mapping" | "map" | "duplicate_check" | "preview" | "import"

interface DuplicateGroup {
  vendorItemNo: string
  count: number
  indices: number[]
}

interface ImportState {
  step: ImportStep
  headers: string[]
  rows: Record<string, string>[]
  mapping: Record<string, string>
  mappedRecords: PricingFileInput[]
  duplicates: DuplicateGroup[]
}

const TARGET_FIELDS = [
  { key: "vendorItemNo", label: "Vendor Item No", required: true },
  { key: "productDescription", label: "Description", required: true },
  { key: "manufacturerNo", label: "Manufacturer No", required: false },
  { key: "listPrice", label: "List Price", required: false },
  { key: "contractPrice", label: "Contract Price", required: false },
  { key: "effectiveDate", label: "Effective Date", required: true },
  { key: "expirationDate", label: "Expiration Date", required: false },
  { key: "category", label: "Category", required: false },
  { key: "uom", label: "UOM", required: false },
  { key: "carveOut", label: "Carve-Out", required: false },
] as const

export type PricingTargetField = (typeof TARGET_FIELDS)[number]

export function usePricingImport() {
  const [state, setState] = useState<ImportState>({
    step: "upload",
    headers: [],
    rows: [],
    mapping: {},
    mappedRecords: [],
    duplicates: [],
  })

  const setStep = useCallback((step: ImportStep) => {
    setState((prev) => ({ ...prev, step }))
  }, [])

  const setParsedData = useCallback(
    async (headers: string[], rows: Record<string, string>[]) => {
      // Show a "mapping..." loading state while Gemini works
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
        // If AI fails, still proceed to manual mapping with empty mapping
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

  const buildRecords = useCallback((): PricingFileInput[] => {
    const { rows, mapping } = state
    return rows
      .map((row) => {
        const rawListPrice = mapping.listPrice
          ? parseFloat(
              (row[mapping.listPrice] ?? "0").replace(/[^0-9.-]/g, "")
            )
          : undefined
        const listPrice =
          rawListPrice !== undefined && Number.isFinite(rawListPrice)
            ? rawListPrice
            : undefined

        const rawContractPrice = mapping.contractPrice
          ? parseFloat(
              (row[mapping.contractPrice] ?? "0").replace(/[^0-9.-]/g, "")
            )
          : undefined
        const contractPrice =
          rawContractPrice !== undefined && Number.isFinite(rawContractPrice)
            ? rawContractPrice
            : undefined

        const rawEffective = (row[mapping.effectiveDate ?? ""] ?? "").trim()
        let effectiveDate = rawEffective
        if (rawEffective) {
          const d = new Date(rawEffective)
          if (!isNaN(d.getTime())) {
            effectiveDate = d.toISOString().slice(0, 10)
          }
        }

        let expirationDate: string | undefined
        if (mapping.expirationDate) {
          const rawExp = (row[mapping.expirationDate] ?? "").trim()
          if (rawExp) {
            const d = new Date(rawExp)
            expirationDate = !isNaN(d.getTime())
              ? d.toISOString().slice(0, 10)
              : rawExp
          }
        }

        let carveOut: boolean | undefined
        if (mapping.carveOut) {
          const raw = (row[mapping.carveOut] ?? "").trim().toLowerCase()
          if (raw) {
            carveOut = ["true", "yes", "1", "y", "x"].includes(raw)
          }
        }

        return {
          vendorItemNo: (row[mapping.vendorItemNo ?? ""] ?? "").trim(),
          productDescription: (
            row[mapping.productDescription ?? ""] ?? ""
          ).trim(),
          manufacturerNo: row[mapping.manufacturerNo ?? ""] || undefined,
          listPrice,
          contractPrice,
          effectiveDate: effectiveDate || new Date().toISOString().slice(0, 10),
          expirationDate,
          category: row[mapping.category ?? ""] || undefined,
          uom: row[mapping.uom ?? ""] || "EA",
          carveOut,
        }
      })
      .filter((r) => r.vendorItemNo && r.productDescription)
  }, [state])

  const detectDuplicates = useCallback(
    (records: PricingFileInput[]): DuplicateGroup[] => {
      const seen = new Map<string, number[]>()
      records.forEach((r, i) => {
        const key = r.vendorItemNo
        if (!key) return
        const indices = seen.get(key) ?? []
        indices.push(i)
        seen.set(key, indices)
      })
      const dupes: DuplicateGroup[] = []
      for (const [vendorItemNo, indices] of seen) {
        if (indices.length > 1) {
          dupes.push({ vendorItemNo, count: indices.length, indices })
        }
      }
      return dupes
    },
    []
  )

  const goToDuplicateCheck = useCallback(() => {
    const records = buildRecords()
    const dupes = detectDuplicates(records)
    setState((prev) => ({
      ...prev,
      mappedRecords: records,
      duplicates: dupes,
      step: "duplicate_check",
    }))
  }, [buildRecords, detectDuplicates])

  const goToPreview = useCallback(() => {
    // If coming from duplicate_check, records are already built
    if (state.step === "duplicate_check") {
      setState((prev) => ({ ...prev, step: "preview" }))
      return
    }
    const records = buildRecords()
    setState((prev) => ({ ...prev, mappedRecords: records, step: "preview" }))
  }, [buildRecords, state.step])

  const reset = useCallback(() => {
    setState({
      step: "upload",
      headers: [],
      rows: [],
      mapping: {},
      mappedRecords: [],
      duplicates: [],
    })
  }, [])

  return {
    ...state,
    targetFields: TARGET_FIELDS as unknown as PricingTargetField[],
    setStep,
    setParsedData,
    setMapping,
    goToDuplicateCheck,
    goToPreview,
    reset,
  }
}
