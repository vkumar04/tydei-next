"use client"

import { useState, useCallback } from "react"
import * as XLSX from "xlsx"

interface ParsedData {
  headers: string[]
  rows: Record<string, string>[]
}

export function useFileParser() {
  const [data, setData] = useState<ParsedData | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parseFile = useCallback(async (file: File) => {
    setIsLoading(true)
    setError(null)

    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: "array" })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) throw new Error("No sheets found in file")

      const sheet = workbook.Sheets[sheetName]
      if (!sheet) throw new Error("Could not read sheet")

      const json = XLSX.utils.sheet_to_json<Record<string, string>>(sheet, {
        defval: "",
        raw: false,
      })

      if (json.length === 0) throw new Error("File contains no data rows")

      const headers = Object.keys(json[0] ?? {})
      setData({ headers, rows: json })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file")
      setData(null)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setData(null)
    setError(null)
  }, [])

  return { data, isLoading, error, parseFile, reset }
}
