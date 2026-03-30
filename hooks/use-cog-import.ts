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
      // Normalise a string for matching: lowercase, strip non-alphanumeric
      const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "")

      // Common CSV/Excel aliases for each target field
      const ALIASES: Record<string, string[]> = {
        inventoryNumber: ["inventorynumber", "inventoryno", "invno", "invnumber", "itemno", "itemnumber", "sku"],
        inventoryDescription: ["inventorydescription", "description", "desc", "itemdescription", "itemdesc", "productdescription"],
        vendorName: ["vendorname", "vendor", "suppliername", "supplier"],
        vendorItemNo: ["vendoritemno", "vendoritemnumber", "vendoritem", "supplieritemno"],
        manufacturerNo: ["manufacturerno", "manufacturernumber", "mfgno", "mfgnumber", "manufacturer"],
        unitCost: ["unitcost", "unitprice", "cost", "price", "eachprice"],
        extendedPrice: ["extendedprice", "extprice", "extendedcost", "totalcost", "totalprice", "lineamount", "linetotal", "amount"],
        quantity: ["quantity", "qty", "units", "count"],
        transactionDate: ["transactiondate", "date", "invoicedate", "orderdate", "txndate", "purchasedate"],
        category: ["category", "cat", "productcategory", "itemcategory", "department", "dept"],
      }

      const autoMapping: Record<string, string> = {}
      for (const field of TARGET_FIELDS) {
        // Try exact normalised match first
        let match = headers.find((h) => norm(h) === norm(field.key))
        // Then try aliases
        if (!match) {
          const aliases = ALIASES[field.key] ?? []
          match = headers.find((h) => aliases.includes(norm(h)))
        }
        // Then try label match (e.g. "Unit Cost" matches field.label "Unit Cost")
        if (!match) {
          match = headers.find((h) => norm(h) === norm(field.label))
        }
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
          extendedPrice = Number.isFinite(rawExt) ? rawExt : undefined
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
